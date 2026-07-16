'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const WhatsAppLeadScore = require('../../../models/WhatsAppLeadScore');
const IitCounsellingSubmission = require('../../../models/IitCounsellingSubmission');
const { buildLeadContextWithBooking } = require('../bookingContext/bookingContextResolver');
const { getLeadDetails } = require('../leadInsights/leadInsightsService');
const { getConversationTranscript, getConversationTranscriptPage } = require('../chatbotAdminService');
const { resolveHandoff } = require('../handoffService');
const { getCopilotHotLeadThreshold } = require('./humanCopilotFlags');
const {
  ensureStructuredSummary,
  loadPriorHandoffs,
} = require('./humanCopilotSummaryV2Service');
const { buildAuditEntry, mapAuditTrail, mapCopilotReplies } = require('./humanCopilotAuditService');
const { sendCopilotReply } = require('./humanCopilotReplyService');
const { inferCopilotState, COPILOT_QUEUE_STATES } = require('./humanCopilotConstants');
const {
  resolveLegacySlot,
  countActiveConversationsForAgent,
  isAgentAssignable,
} = require('./humanCopilotAgentService');
const Admin = require('../../../models/Admin');

const SR_COUNSELLORS = new Set(['sr1', 'sr2']);
const DEFAULT_STATUSES = ['open', 'claimed'];

function deriveAlertReasons(handoff, leadScore) {
  const reasons = [];
  if (handoff.reason === 'user_requested') reasons.push('human_requested');
  if (handoff.reason === 'low_confidence') reasons.push('low_confidence');
  if (handoff.isReopened || handoff.reason === 'reopened' || handoff.copilotState === 'reopened') {
    reasons.push('reopened');
  }
  const threshold = getCopilotHotLeadThreshold();
  if (leadScore != null && leadScore >= threshold) reasons.push('hot_lead');
  return reasons;
}

function mapHandoffRow(handoff, scoreDoc = null, agentName = null) {
  const leadScore = scoreDoc?.leadScore ?? null;
  const leadStage = scoreDoc?.leadStage ?? null;
  const replies = handoff.copilotReplies || [];
  const failedReply = replies.find((r) => r.status === 'failed');
  const latestReply = replies.length ? replies[replies.length - 1] : null;

  return {
    id: String(handoff._id),
    conversationId: String(handoff.conversationId),
    phone: handoff.phone,
    productLine: handoff.productLine,
    status: handoff.status,
    copilotState: inferCopilotState(handoff),
    route: handoff.route,
    reason: handoff.reason,
    isReopened: Boolean(handoff.isReopened),
    userLastMessage: handoff.userLastMessage,
    assignedSrCounsellor: handoff.assignedSrCounsellor || null,
    assignedAgentId: handoff.assignedAgentId ? String(handoff.assignedAgentId) : null,
    assignedAgentName: agentName || null,
    lastRoutingDecision: handoff.lastRoutingDecision || null,
    assignedByAdminId: handoff.assignedByAdminId ? String(handoff.assignedByAdminId) : null,
    assignedAt: handoff.assignedAt || null,
    activeAdminId: handoff.activeAdminId ? String(handoff.activeAdminId) : null,
    repliedByAdminId: handoff.repliedByAdminId ? String(handoff.repliedByAdminId) : null,
    repliedAt: handoff.repliedAt || null,
    resolvedByAdminId: handoff.resolvedByAdminId ? String(handoff.resolvedByAdminId) : null,
    lockVersion: handoff.lockVersion ?? 0,
    summaryForAgent: handoff.summaryForAgent,
    createdAt: handoff.createdAt,
    updatedAt: handoff.updatedAt,
    claimedAt: handoff.claimedAt,
    resolvedAt: handoff.resolvedAt,
    expiresAt: handoff.expiresAt,
    firstResponseAt: handoff.firstResponseAt || null,
    leadScore,
    leadStage,
    alertReasons: deriveAlertReasons(handoff, leadScore),
    latestDeliveryStatus: latestReply?.status || null,
    failedReply: failedReply
      ? {
          id: String(failedReply._id),
          draftText: failedReply.draftText,
          errorMessage: failedReply.errorMessage,
        }
      : null,
  };
}

async function loadScoresByPhone(phones) {
  const map = new Map();
  if (!phones.length) return map;
  const rows = await WhatsAppLeadScore.find({ phone: { $in: phones } })
    .select('phone leadScore leadStage')
    .lean();
  for (const row of rows) {
    map.set(row.phone, row);
  }
  return map;
}

async function listQueue({ srCounsellor = null, agentId = null, status = null, limit = 50 } = {}) {
  const filter = {
    route: 'admin_pool',
    status: status ? status : { $in: DEFAULT_STATUSES },
    $or: [
      { copilotState: { $in: COPILOT_QUEUE_STATES } },
      { copilotState: { $exists: false } },
      { copilotState: null },
    ],
  };
  if (agentId) {
    filter.assignedAgentId = agentId;
  } else if (srCounsellor === 'unassigned') {
    filter.assignedSrCounsellor = null;
    filter.assignedAgentId = null;
  } else if (srCounsellor && SR_COUNSELLORS.has(srCounsellor)) {
    filter.assignedSrCounsellor = srCounsellor;
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const handoffs = await WhatsAppAgentHandoff.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  const scoreMap = await loadScoresByPhone(handoffs.map((h) => h.phone));
  return handoffs.map((h) => mapHandoffRow(h, scoreMap.get(h.phone)));
}

async function getNotifications() {
  const items = await listQueue({ limit: 100 });
  return items.filter((item) => item.alertReasons.length > 0);
}

async function getHandoffById(handoffId) {
  return WhatsAppAgentHandoff.findById(handoffId).lean();
}

function buildUserProfile(leadContext) {
  if (!leadContext) return null;
  return {
    phone: leadContext.phone,
    productLine: leadContext.productLine,
    name: leadContext.iit?.fullName || leadContext.gx?.fullName || null,
    iit: leadContext.iit,
    guidexpert: leadContext.gx,
  };
}

async function loadIitExtras(handoff) {
  let iit = null;
  if (handoff.iitCounsellingSubmissionId) {
    iit = await IitCounsellingSubmission.findById(handoff.iitCounsellingSubmissionId)
      .select('iitCounselling.section1Data')
      .lean();
  } else if (handoff.phone) {
    iit = await IitCounsellingSubmission.findOne({ phone: handoff.phone })
      .sort({ updatedAt: -1 })
      .select('iitCounselling.section1Data')
      .lean();
  }
  if (!iit) return null;
  const s1 = iit.iitCounselling?.section1Data || {};
  return {
    stream: s1.stream || null,
    city: s1.city || null,
    studentOrParent: s1.studentOrParent || null,
    topColleges: Array.isArray(s1.top5Colleges) ? s1.top5Colleges.filter(Boolean).join(', ') : null,
  };
}

async function getHandoffDetail(handoffId) {
  const handoff = await getHandoffById(handoffId);
  if (!handoff) return { error: 'not_found' };
  if (handoff.route !== 'admin_pool') return { error: 'not_copilot_handoff' };

  const [transcript, leadContext, leadDetails, scoreDoc, priorHandoffs, iitExtras] = await Promise.all([
    getConversationTranscript(handoff.conversationId, 120),
    buildLeadContextWithBooking({
      phone10: handoff.phone,
      productLine: handoff.productLine,
      formSubmissionId: handoff.formSubmissionId,
      iitCounsellingSubmissionId: handoff.iitCounsellingSubmissionId,
    }, handoff.conversationId, {
      _id: handoff.conversationId,
      currentHandoffId: handoff._id,
      status: 'handoff',
      botPaused: true,
    }),
    getLeadDetails(handoff.phone),
    WhatsAppLeadScore.findOne({ phone: handoff.phone })
      .select('phone leadScore leadStage scoreReasons confidence lastScoredAt')
      .lean(),
    loadPriorHandoffs(handoff.phone, handoff._id),
    loadIitExtras(handoff),
  ]);

  const summaryResult = await ensureStructuredSummary(handoff, {
    handoff,
    leadDetails,
    transcript,
    leadContext,
    priorHandoffs,
    iitExtras,
  });

  const mapped = mapHandoffRow(handoff, scoreDoc);
  mapped.internalNotes = handoff.internalNotes || [];
  mapped.copilotAiSummary = summaryResult.aiSummary;
  mapped.copilotReplies = mapCopilotReplies(handoff.copilotReplies);
  mapped.auditTrail = mapAuditTrail(handoff.auditTrail);

  const recentEvents = (leadDetails.recentEvents || []).flatMap((row) =>
    (row.events || []).map((e) => ({
      type: e.type,
      value: e.value,
      confidence: e.confidence,
      evidence: e.evidence,
      createdAt: row.createdAt,
    }))
  );

  return {
    handoff: mapped,
    transcript: {
      conversation: transcript.conversation,
      messageCount: (transcript.messages || []).length,
    },
    userProfile: buildUserProfile(leadContext),
    leadProfile: leadDetails.profile,
    leadScore: leadDetails.score,
    recentEvents,
    summaryForAgent: handoff.summaryForAgent,
    aiSummary: summaryResult.aiSummary,
    structuredSummary: summaryResult.structuredSummary,
    summarySource: summaryResult.summarySource,
    summaryCached: summaryResult.summaryCached,
    auditTrail: mapped.auditTrail,
    copilotReplies: mapped.copilotReplies,
  };
}

async function assignHandoffByAgent(
  handoffId,
  agentId,
  adminId,
  { lockVersion = null, force = false, routingDecision = null, isAutoAssign = false, auditAction = null, auditMetaExtra = null } = {}
) {
  const agentAdmin = await Admin.findById(agentId).select('username name copilotAgentProfile').lean();
  if (!agentAdmin || !agentAdmin.copilotAgentProfile?.enabled) {
    return { success: false, error: 'invalid_agent' };
  }

  if (!isAutoAssign) {
    const activeCount = await countActiveConversationsForAgent(agentAdmin);
    if (!isAgentAssignable(agentAdmin, activeCount) && !force) {
      return { success: false, error: 'agent_overloaded' };
    }
  }

  const profile = agentAdmin.copilotAgentProfile || {};
  const srCounsellor = profile.legacySlot && SR_COUNSELLORS.has(profile.legacySlot)
    ? profile.legacySlot
    : null;
  const actingAdminId = adminId || agentId;

  const existing = await getHandoffById(handoffId);
  if (!existing || existing.route !== 'admin_pool') {
    return { success: false, error: 'not_found' };
  }
  if (!DEFAULT_STATUSES.includes(existing.status)) {
    return { success: false, error: 'handoff_closed' };
  }

  const existingAgentId = existing.assignedAgentId ? String(existing.assignedAgentId) : null;
  if (
    !force &&
    (existingAgentId || existing.assignedSrCounsellor) &&
    existingAgentId !== String(agentId) &&
    (srCounsellor ? existing.assignedSrCounsellor !== srCounsellor : true) &&
    existing.activeAdminId &&
    String(existing.activeAdminId) !== String(actingAdminId)
  ) {
    return {
      success: false,
      error: 'already_assigned',
      assignedSrCounsellor: existing.assignedSrCounsellor,
      assignedAgentId: existingAgentId,
      activeAdminId: String(existing.activeAdminId),
      lockVersion: existing.lockVersion,
      handoff: mapHandoffRow(existing),
    };
  }

  const now = new Date();
  const filter = {
    _id: handoffId,
    route: 'admin_pool',
    status: { $in: DEFAULT_STATUSES },
  };
  if (lockVersion != null) filter.lockVersion = lockVersion;
  if (!force) {
    filter.$or = [
      { assignedAgentId: null, assignedSrCounsellor: null },
      { assignedAgentId: agentId },
      { activeAdminId: actingAdminId },
    ];
    if (srCounsellor) {
      filter.$or.push({ assignedSrCounsellor: srCounsellor });
    }
  }

  const nextState =
    existing.copilotState === 'active' || existing.lastAgentMessageAt ? 'active' : 'assigned';

  const setFields = {
    assignedAgentId: agentId,
    assignedByAdminId: actingAdminId,
    assignedAt: existing.assignedAt || now,
    activeAdminId: actingAdminId,
    assignmentLockedAt: now,
    copilotState: existing.copilotState === 'reopened' ? 'assigned' : nextState,
    status: 'claimed',
    claimedAt: existing.claimedAt || now,
  };
  if (srCounsellor) setFields.assignedSrCounsellor = srCounsellor;

  if (routingDecision) {
    setFields.lastRoutingDecision = {
      mode: routingDecision.routingMode,
      reason: routingDecision.reason,
      fallbackUsed: Boolean(routingDecision.fallback?.used),
      fallbackRole: routingDecision.fallback?.role || null,
      at: now,
    };
  }

  const auditActionName =
    auditAction || (isAutoAssign ? 'auto_assigned' : 'assigned');
  const auditMeta = {
    lockVersion: (existing.lockVersion ?? 0) + 1,
    agentId: String(agentId),
    routingMode: routingDecision?.routingMode || null,
    reason: routingDecision?.reason || null,
    ...(auditMetaExtra || {}),
  };

  const handoff = await WhatsAppAgentHandoff.findOneAndUpdate(
    filter,
    {
      $set: setFields,
      $inc: { lockVersion: 1 },
      $push: {
        auditTrail: buildAuditEntry({
          action: auditActionName,
          adminId: actingAdminId,
          srCounsellor,
          meta: auditMeta,
        }),
      },
    },
    { new: true }
  ).lean();

  if (!handoff) {
    const current = await getHandoffById(handoffId);
    if (
      current?.activeAdminId &&
      String(current.activeAdminId) !== String(actingAdminId) &&
      current.assignedAgentId &&
      String(current.assignedAgentId) !== String(agentId)
    ) {
      return {
        success: false,
        error: 'already_assigned',
        assignedSrCounsellor: current.assignedSrCounsellor,
        assignedAgentId: current.assignedAgentId ? String(current.assignedAgentId) : null,
        lockVersion: current.lockVersion,
        handoff: mapHandoffRow(current),
      };
    }
    if (lockVersion != null && current?.lockVersion !== lockVersion) {
      return { success: false, error: 'version_conflict', lockVersion: current?.lockVersion };
    }
    return { success: false, error: 'assign_failed' };
  }

  const scoreDoc = await WhatsAppLeadScore.findOne({ phone: handoff.phone })
    .select('phone leadScore leadStage')
    .lean();
  const agentName = agentAdmin.name || agentAdmin.username;
  return {
    success: true,
    handoff: mapHandoffRow(handoff, scoreDoc, agentName),
    lockVersion: handoff.lockVersion,
  };
}

async function assignHandoff(handoffId, target, adminId, { lockVersion = null, force = false, auditAction = null, auditMetaExtra = null } = {}) {
  let srCounsellor = null;
  let agentId = null;

  if (typeof target === 'string') {
    srCounsellor = target;
  } else if (target && typeof target === 'object') {
    srCounsellor = target.srCounsellor || null;
    agentId = target.agentId || null;
  }

  if (agentId) {
    return assignHandoffByAgent(handoffId, agentId, adminId, { lockVersion, force, auditAction, auditMetaExtra });
  }

  if (!srCounsellor || !SR_COUNSELLORS.has(srCounsellor)) {
    return { success: false, error: 'invalid_sr_counsellor' };
  }

  const legacyAgent = await resolveLegacySlot(srCounsellor);
  if (legacyAgent) {
    return assignHandoffByAgent(handoffId, legacyAgent._id, adminId, { lockVersion, force, auditAction, auditMetaExtra });
  }

  const existing = await getHandoffById(handoffId);
  if (!existing || existing.route !== 'admin_pool') {
    return { success: false, error: 'not_found' };
  }
  if (!DEFAULT_STATUSES.includes(existing.status)) {
    return { success: false, error: 'handoff_closed' };
  }

  if (
    !force &&
    existing.assignedSrCounsellor &&
    existing.assignedSrCounsellor !== srCounsellor &&
    existing.activeAdminId &&
    String(existing.activeAdminId) !== String(adminId)
  ) {
    return {
      success: false,
      error: 'already_assigned',
      assignedSrCounsellor: existing.assignedSrCounsellor,
      activeAdminId: String(existing.activeAdminId),
      lockVersion: existing.lockVersion,
      handoff: mapHandoffRow(existing),
    };
  }

  const now = new Date();
  const filter = {
    _id: handoffId,
    route: 'admin_pool',
    status: { $in: DEFAULT_STATUSES },
  };
  if (lockVersion != null) filter.lockVersion = lockVersion;
  if (!force) {
    filter.$or = [
      { assignedSrCounsellor: null },
      { assignedSrCounsellor: srCounsellor },
      { activeAdminId: adminId },
    ];
  }

  const nextState =
    existing.copilotState === 'active' || existing.lastAgentMessageAt ? 'active' : 'assigned';

  const handoff = await WhatsAppAgentHandoff.findOneAndUpdate(
    filter,
    {
      $set: {
        assignedSrCounsellor: srCounsellor,
        assignedByAdminId: adminId,
        assignedAt: existing.assignedAt || now,
        activeAdminId: adminId,
        assignmentLockedAt: now,
        copilotState: existing.copilotState === 'reopened' ? 'assigned' : nextState,
        status: 'claimed',
        claimedAt: existing.claimedAt || now,
      },
      $inc: { lockVersion: 1 },
      $push: {
        auditTrail: buildAuditEntry({
          action: auditAction || 'assigned',
          adminId,
          srCounsellor,
          meta: {
            lockVersion: (existing.lockVersion ?? 0) + 1,
            ...(auditMetaExtra || {}),
          },
        }),
      },
    },
    { new: true }
  ).lean();

  if (!handoff) {
    const current = await getHandoffById(handoffId);
    if (
      current?.assignedSrCounsellor &&
      current.assignedSrCounsellor !== srCounsellor &&
      current.activeAdminId &&
      String(current.activeAdminId) !== String(adminId)
    ) {
      return {
        success: false,
        error: 'already_assigned',
        assignedSrCounsellor: current.assignedSrCounsellor,
        lockVersion: current.lockVersion,
        handoff: mapHandoffRow(current),
      };
    }
    if (lockVersion != null && current?.lockVersion !== lockVersion) {
      return { success: false, error: 'version_conflict', lockVersion: current?.lockVersion };
    }
    return { success: false, error: 'assign_failed' };
  }

  const scoreDoc = await WhatsAppLeadScore.findOne({ phone: handoff.phone })
    .select('phone leadScore leadStage')
    .lean();
  return {
    success: true,
    handoff: mapHandoffRow(handoff, scoreDoc),
    lockVersion: handoff.lockVersion,
  };
}

async function addInternalNote(handoffId, adminId, text) {
  const noteText = String(text || '').trim();
  if (!noteText) return { success: false, error: 'text_required' };

  const handoff = await WhatsAppAgentHandoff.findOneAndUpdate(
    {
      _id: handoffId,
      route: 'admin_pool',
      status: { $in: DEFAULT_STATUSES },
    },
    {
      $push: {
        internalNotes: {
          text: noteText.slice(0, 2000),
          authorAdminId: adminId,
          createdAt: new Date(),
        },
        auditTrail: buildAuditEntry({
          action: 'note_added',
          adminId,
        }),
      },
    },
    { new: true }
  ).lean();

  if (!handoff) return { success: false, error: 'not_found' };
  return { success: true, internalNotes: handoff.internalNotes || [] };
}

async function sendReply(handoffId, adminId, text, options = {}) {
  return sendCopilotReply(handoffId, adminId, text, options);
}

async function retryReply(handoffId, adminId, replyId, { lockVersion = null } = {}) {
  const handoff = await getHandoffById(handoffId);
  if (!handoff) return { success: false, error: 'not_found' };
  const failed = (handoff.copilotReplies || []).find(
    (r) => String(r._id) === String(replyId) && r.status === 'failed'
  );
  if (!failed) return { success: false, error: 'retry_not_available' };
  return sendCopilotReply(handoffId, adminId, failed.draftText, {
    lockVersion,
    retryReplyId: replyId,
    suggestedText: failed.suggestedText,
    replySource: failed.replySource,
  });
}

async function resolveHandoffForCopilot(handoffId, adminId, { lockVersion = null } = {}) {
  const handoff = await getHandoffById(handoffId);
  if (!handoff || handoff.route !== 'admin_pool') {
    return { success: false, error: 'not_found' };
  }
  if (!DEFAULT_STATUSES.includes(handoff.status)) {
    return { success: false, error: 'handoff_closed' };
  }

  const filter = { _id: handoffId, route: 'admin_pool', status: { $in: DEFAULT_STATUSES } };
  if (lockVersion != null) filter.lockVersion = lockVersion;

  const now = new Date();
  const updated = await WhatsAppAgentHandoff.findOneAndUpdate(
    filter,
    {
      $set: {
        resolvedByAdminId: adminId,
        copilotState: 'resolved',
        activeAdminId: null,
      },
      $inc: { lockVersion: 1 },
      $push: {
        auditTrail: buildAuditEntry({
          action: 'resolved',
          adminId,
          srCounsellor: handoff.assignedSrCounsellor,
        }),
      },
    },
    { new: true }
  ).lean();

  if (!updated) {
    const current = await getHandoffById(handoffId);
    if (lockVersion != null && current?.lockVersion !== lockVersion) {
      return { success: false, error: 'version_conflict', lockVersion: current?.lockVersion };
    }
    return { success: false, error: 'resolve_failed' };
  }

  const result = await resolveHandoff(handoffId, { resolvedBy: 'admin', adminId });
  if (!result.success) return result;

  const refreshed = await getHandoffById(handoffId);
  const scoreDoc = await WhatsAppLeadScore.findOne({ phone: handoff.phone })
    .select('phone leadScore leadStage')
    .lean();
  return { success: true, handoff: mapHandoffRow(refreshed, scoreDoc), lockVersion: refreshed?.lockVersion };
}

async function releaseHandoff(handoffId, adminId, { lockVersion = null } = {}) {
  const existing = await getHandoffById(handoffId);
  if (!existing || existing.route !== 'admin_pool') {
    return { success: false, error: 'not_found' };
  }
  if (!DEFAULT_STATUSES.includes(existing.status)) {
    return { success: false, error: 'handoff_closed' };
  }
  if (!existing.activeAdminId) {
    return { success: false, error: 'not_claimed' };
  }

  const filter = { _id: handoffId, route: 'admin_pool', status: { $in: DEFAULT_STATUSES } };
  if (lockVersion != null) filter.lockVersion = lockVersion;

  const nextState =
    existing.assignedAgentId || existing.assignedSrCounsellor ? 'assigned' : 'pending';

  const handoff = await WhatsAppAgentHandoff.findOneAndUpdate(
    filter,
    {
      $set: {
        activeAdminId: null,
        copilotState: nextState,
      },
      $inc: { lockVersion: 1 },
      $push: {
        auditTrail: buildAuditEntry({
          action: 'released',
          adminId,
          srCounsellor: existing.assignedSrCounsellor,
          meta: {
            previousActiveAdminId: String(existing.activeAdminId),
            assignedAgentId: existing.assignedAgentId ? String(existing.assignedAgentId) : null,
          },
        }),
      },
    },
    { new: true }
  ).lean();

  if (!handoff) {
    const current = await getHandoffById(handoffId);
    if (lockVersion != null && current?.lockVersion !== lockVersion) {
      return { success: false, error: 'version_conflict', lockVersion: current?.lockVersion };
    }
    return { success: false, error: 'release_failed' };
  }

  const scoreDoc = await WhatsAppLeadScore.findOne({ phone: handoff.phone })
    .select('phone leadScore leadStage')
    .lean();
  return { success: true, handoff: mapHandoffRow(handoff, scoreDoc), lockVersion: handoff.lockVersion };
}

async function reassignHandoff(handoffId, target, adminId, { lockVersion = null } = {}) {
  const existing = await getHandoffById(handoffId);
  if (!existing || existing.route !== 'admin_pool') {
    return { success: false, error: 'not_found' };
  }
  if (!DEFAULT_STATUSES.includes(existing.status)) {
    return { success: false, error: 'handoff_closed' };
  }

  const auditMetaExtra = {
    previousAgentId: existing.assignedAgentId ? String(existing.assignedAgentId) : null,
    previousActiveAdminId: existing.activeAdminId ? String(existing.activeAdminId) : null,
    previousSrCounsellor: existing.assignedSrCounsellor || null,
  };

  return assignHandoff(handoffId, target, adminId, {
    lockVersion,
    force: true,
    auditAction: 'reassigned',
    auditMetaExtra,
  });
}

async function getHandoffMessages(handoffId, query = {}) {
  const handoff = await getHandoffById(handoffId);
  if (!handoff) return { error: 'not_found' };
  if (handoff.route !== 'admin_pool') return { error: 'not_copilot_handoff' };

  const page = await getConversationTranscriptPage(handoff.conversationId, {
    limit: query.limit,
    before: query.before || null,
    beforeId: query.beforeId || null,
    after: query.after || null,
    afterId: query.afterId || null,
  });

  return {
    messages: page.messages,
    hasMoreOlder: page.hasMoreOlder,
    hasMoreNewer: page.hasMoreNewer,
    oldestCursor: page.oldestCursor,
    newestCursor: page.newestCursor,
  };
}

async function maybeAutoAssign(handoffId) {
  const { isCopilotAutoAssignEnabled } = require('./humanCopilotFlags');
  if (!isCopilotAutoAssignEnabled()) return null;

  const { autoAssignHandoff } = require('./humanCopilotRoutingService');
  const result = await autoAssignHandoff(handoffId);
  if (!result.success || !result.assigned) return null;
  return result.handoff || (await getHandoffById(handoffId));
}

module.exports = {
  deriveAlertReasons,
  listQueue,
  getNotifications,
  getHandoffById,
  getHandoffDetail,
  getHandoffMessages,
  assignHandoff,
  assignHandoffByAgent,
  addInternalNote,
  sendReply,
  retryReply,
  releaseHandoff,
  reassignHandoff,
  resolveHandoffForCopilot,
  maybeAutoAssign,
  SR_COUNSELLORS,
};
