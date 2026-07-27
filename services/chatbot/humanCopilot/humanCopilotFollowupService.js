'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const WhatsAppLeadScore = require('../../../models/WhatsAppLeadScore');
const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildLeadContextWithBooking } = require('../bookingContext/bookingContextResolver');
const { getLeadDetails } = require('../leadInsights/leadInsightsService');
const { getConversationTranscript } = require('../chatbotAdminService');
const { buildAuditEntry } = require('./humanCopilotAuditService');
const { sendCopilotReply } = require('./humanCopilotReplyService');
const { getCopilotHotLeadThreshold, isCopilotSuggestedRepliesEnabled } = require('./humanCopilotFlags');
const { extractEditTopic } = require('./humanCopilotLearningService');

const provider = new OpenAiCompatibleProvider();

const FOLLOWUP_CATEGORIES = Object.freeze([
  'reminder',
  'reconnect',
  'booking',
  'information',
  'missed_session',
]);

const PRIORITY_RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

function parseInactiveDays(inactiveDays = 3) {
  const parsed = parseInt(inactiveDays, 10);
  if ([1, 3, 7].includes(parsed)) return parsed;
  return 3;
}

function buildMeta(inactiveDays) {
  const days = parseInactiveDays(inactiveDays);
  return { inactiveDays: days, generatedAt: new Date() };
}

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  return Math.floor((to - start) / (24 * 60 * 60 * 1000));
}

function getLastInboundAt(transcript) {
  const messages = transcript?.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.direction === 'in' && messages[i]?.at) {
      return new Date(messages[i].at);
    }
  }
  return null;
}

function hasInboundAfter(transcript, since) {
  if (!since) return false;
  const cutoff = new Date(since).getTime();
  return (transcript?.messages || []).some(
    (m) => m.direction === 'in' && m.at && new Date(m.at).getTime() > cutoff
  );
}

function parseSlotDate(leadContext) {
  const raw =
    leadContext?.iit?.slotBookingDate ||
    leadContext?.gx?.slotDateLabel ||
    leadContext?.iit?.slotInstantLabel ||
    null;
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const lower = String(raw).toLowerCase();
  if (lower.includes('today')) return today;
  if (lower.includes('tomorrow')) return tomorrow;
  return null;
}

function calendarDayDiff(target, base = new Date()) {
  const a = new Date(target);
  const b = new Date(base);
  if (Number.isNaN(a.getTime())) return null;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function detectBookingScenario(leadContext) {
  const slotDate = parseSlotDate(leadContext);
  if (!slotDate) return null;
  const diff = calendarDayDiff(slotDate, new Date());
  if (diff === 0) return { scenario: 'booking_today', category: 'booking', priority: 'high', delayDays: 0 };
  if (diff === 1) return { scenario: 'booking_tomorrow', category: 'reminder', priority: 'high', delayDays: 1 };
  return null;
}

function detectMissedSession(leadContext) {
  const labels = [
    leadContext?.iit?.demoStatusLabel,
    leadContext?.iit?.callStatusLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\b(missed|no show|not attended|absent)\b/.test(labels)) {
    return { scenario: 'missed_session', category: 'missed_session', priority: 'high', delayDays: 0 };
  }
  return null;
}

function detectIntentScenario(handoff) {
  const text = [
    handoff.copilotStructuredSummary?.currentConcern,
    handoff.copilotStructuredSummary?.studentGoal,
    handoff.userLastMessage,
  ]
    .filter(Boolean)
    .join(' ');
  const topic = extractEditTopic(text);
  if (topic === 'general') return null;
  return {
    scenario: `intent_${topic}`,
    category: 'information',
    priority: 'medium',
    delayDays: 2,
    topic,
  };
}

function detectInactiveScenario(inactiveDays, daysSinceReply) {
  if (daysSinceReply == null || daysSinceReply < inactiveDays) return null;
  let priority = 'low';
  if (inactiveDays >= 7) priority = 'high';
  else if (inactiveDays >= 3) priority = 'medium';
  return {
    scenario: `inactive_${inactiveDays}d`,
    category: 'reconnect',
    priority,
    delayDays: inactiveDays,
  };
}

function detectHotLeadScenario(scoreDoc, daysSinceReply, handoff) {
  const threshold = getCopilotHotLeadThreshold();
  const score = scoreDoc?.leadScore;
  if (score == null || score < threshold) return null;
  if (daysSinceReply == null || daysSinceReply < 1) return null;
  const openStates = ['assigned', 'active', 'reopened'];
  if (!openStates.includes(handoff.copilotState) && handoff.status === 'resolved') {
    return null;
  }
  return {
    scenario: 'hot_lead_stalled',
    category: 'reconnect',
    priority: 'high',
    delayDays: Math.min(daysSinceReply, 3),
  };
}

function pickBestScenario(scenarios) {
  const ranked = scenarios.filter(Boolean).sort((a, b) => {
    const pr = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
    if (pr !== 0) return pr;
    return (b.delayDays || 0) - (a.delayDays || 0);
  });
  return ranked[0] || null;
}

function topicPhrase(topic) {
  const map = {
    scholarship: 'scholarship options',
    fees: 'fee and budget questions',
    hostel: 'hostel facilities',
    placements: 'placement guidance',
    branch_selection: 'branch selection',
    rank_guidance: 'rank and admission guidance',
    college_selection: 'college shortlisting',
    general: 'your counselling query',
  };
  return map[topic] || map.general;
}

function buildRulesFollowup(scenario, ctx) {
  const name =
    ctx.leadContext?.iit?.fullName ||
    ctx.leadContext?.gx?.fullName ||
    'there';
  const branch =
    ctx.leadDetails?.profile?.branchInterest ||
    ctx.handoff.copilotStructuredSummary?.studentGoal ||
    'admissions';

  if (scenario.scenario === 'booking_today') {
    return {
      purpose: 'Remind about counselling session today',
      suggestedMessage: `Hi ${name}! This is a reminder that your GuideXpert counselling session is scheduled for today. Please join on time or let us know if you need to reschedule.`,
      priority: 'high',
      recommendedDelayDays: 0,
      category: 'booking',
      scenario: scenario.scenario,
      source: 'rules',
    };
  }

  if (scenario.scenario === 'booking_tomorrow') {
    return {
      purpose: 'Remind about counselling session tomorrow',
      suggestedMessage: `Hi ${name}! Your counselling session is scheduled for tomorrow. Reply here if you want to confirm your slot or need any preparation guidance.`,
      priority: 'high',
      recommendedDelayDays: 1,
      category: 'reminder',
      scenario: scenario.scenario,
      source: 'rules',
    };
  }

  if (scenario.scenario === 'missed_session') {
    return {
      purpose: 'Reconnect after missed counselling session',
      suggestedMessage: `Hi ${name}! We noticed you could not attend the scheduled counselling session. Would you like to book another slot? We are happy to help with ${branch}.`,
      priority: 'high',
      recommendedDelayDays: 0,
      category: 'missed_session',
      scenario: scenario.scenario,
      source: 'rules',
    };
  }

  if (scenario.scenario === 'hot_lead_stalled') {
    return {
      purpose: 'Reconnect inactive hot lead',
      suggestedMessage: `Hi! Just checking whether you still need guidance regarding ${branch}. Please let us know if you would like to continue.`,
      priority: 'high',
      recommendedDelayDays: scenario.delayDays || 3,
      category: 'reconnect',
      scenario: scenario.scenario,
      source: 'rules',
    };
  }

  if (scenario.scenario?.startsWith('intent_')) {
    const topic = scenario.topic || scenario.scenario.replace('intent_', '');
    return {
      purpose: `Follow up on ${topicPhrase(topic)}`,
      suggestedMessage: `Hi ${name}! Following up on your question about ${topicPhrase(topic)}. Share any updates and we can guide you on the next steps.`,
      priority: 'medium',
      recommendedDelayDays: scenario.delayDays || 2,
      category: 'information',
      scenario: scenario.scenario,
      source: 'rules',
    };
  }

  return {
    purpose: `Reconnect after ${scenario.delayDays || 3} days of inactivity`,
    suggestedMessage: `Hi ${name}! We have not heard from you recently. If you still need help with ${branch}, reply here and your counsellor will assist you.`,
    priority: scenario.priority || 'medium',
    recommendedDelayDays: scenario.delayDays || 3,
    category: 'reconnect',
    scenario: scenario.scenario,
    source: 'rules',
  };
}

function parseLlmFollowupJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function enhanceFollowupWithLlm(rulesFollowup, ctx) {
  if (!isCopilotSuggestedRepliesEnabled() || !String(process.env.LLM_API_KEY || '').trim()) {
    return rulesFollowup;
  }

  const contextBlock = JSON.stringify(
    {
      rulesFollowup,
      summary: ctx.handoff.copilotStructuredSummary,
      leadScore: ctx.scoreDoc,
      userLastMessage: ctx.handoff.userLastMessage,
      inactiveDays: ctx.inactiveDays,
    },
    null,
    0
  ).slice(0, 8000);

  try {
    const completion = await provider.chatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You improve counsellor follow-up suggestions. Return strict JSON with keys: purpose, suggestedMessage, priority (high|medium|low), recommendedDelayDays, category (reminder|reconnect|booking|information|missed_session). Keep messages under 350 characters. Never promise automatic actions.',
        },
        { role: 'user', content: `Improve this follow-up using only context below.\n\n${contextBlock}` },
      ],
      temperature: 0.5,
      maxTokens: 400,
      timeoutMs: 8000,
    });
    const parsed = parseLlmFollowupJson(completion.text);
    if (!parsed?.suggestedMessage) return rulesFollowup;
    return {
      ...rulesFollowup,
      purpose: String(parsed.purpose || rulesFollowup.purpose).slice(0, 500),
      suggestedMessage: String(parsed.suggestedMessage).slice(0, 3500),
      priority: ['high', 'medium', 'low'].includes(parsed.priority)
        ? parsed.priority
        : rulesFollowup.priority,
      recommendedDelayDays: Number.isFinite(Number(parsed.recommendedDelayDays))
        ? Math.min(Math.max(Number(parsed.recommendedDelayDays), 0), 30)
        : rulesFollowup.recommendedDelayDays,
      category: FOLLOWUP_CATEGORIES.includes(parsed.category)
        ? parsed.category
        : rulesFollowup.category,
      source: 'llm',
    };
  } catch (err) {
    console.warn('[humanCopilotFollowup] LLM enhance failed', err?.message || err);
    return rulesFollowup;
  }
}

function mapFollowupDoc(doc, handoffMeta = {}) {
  return {
    id: String(doc._id),
    handoffId: handoffMeta.handoffId ? String(handoffMeta.handoffId) : null,
    phone: handoffMeta.phone || null,
    productLine: handoffMeta.productLine || null,
    assignedSrCounsellor: handoffMeta.assignedSrCounsellor || null,
    category: doc.category,
    scenario: doc.scenario,
    purpose: doc.purpose,
    suggestedMessage: doc.suggestedMessage,
    priority: doc.priority,
    recommendedDelayDays: doc.recommendedDelayDays,
    status: doc.status,
    source: doc.source,
    sentAt: doc.sentAt || null,
    skippedAt: doc.skippedAt || null,
    responseReceived: doc.responseReceived || null,
    createdAt: doc.createdAt,
    lockVersion: handoffMeta.lockVersion ?? null,
  };
}

function getPendingFollowup(handoff) {
  const rows = handoff.copilotFollowups || [];
  return [...rows].reverse().find((row) => row.status === 'suggested') || null;
}

async function loadHandoffContext(handoff, inactiveDays) {
  const [transcript, leadContext, leadDetails, scoreDoc] = await Promise.all([
    getConversationTranscript(handoff.conversationId, 80),
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
      .select('phone leadScore leadStage')
      .lean(),
  ]);

  const lastInboundAt = getLastInboundAt(transcript);
  const daysSinceReply = daysBetween(lastInboundAt || handoff.lastAgentMessageAt || handoff.updatedAt);

  return {
    handoff,
    transcript,
    leadContext,
    leadDetails,
    scoreDoc,
    inactiveDays: parseInactiveDays(inactiveDays),
    daysSinceReply,
    lastInboundAt,
  };
}

async function generateFollowupSuggestion(ctx, { useLlm = false } = {}) {
  const scenarios = [
    detectMissedSession(ctx.leadContext),
    detectBookingScenario(ctx.leadContext),
    detectHotLeadScenario(ctx.scoreDoc, ctx.daysSinceReply, ctx.handoff),
    detectIntentScenario(ctx.handoff),
    detectInactiveScenario(ctx.inactiveDays, ctx.daysSinceReply),
  ];
  const best = pickBestScenario(scenarios);
  if (!best) return null;

  let followup = buildRulesFollowup(best, ctx);
  if (useLlm) {
    followup = await enhanceFollowupWithLlm(followup, ctx);
  }
  return followup;
}

async function persistFollowupSuggestion(handoffId, followup, adminId = null) {
  const entry = {
    ...followup,
    status: 'suggested',
    createdAt: new Date(),
  };
  await WhatsAppAgentHandoff.updateOne(
    { _id: handoffId },
    {
      $push: {
        copilotFollowups: entry,
        auditTrail: buildAuditEntry({
          action: 'followup_suggested',
          adminId,
          meta: {
            category: followup.category,
            scenario: followup.scenario,
            priority: followup.priority,
          },
        }),
      },
    }
  );
  const handoff = await WhatsAppAgentHandoff.findById(handoffId).lean();
  const created = getPendingFollowup(handoff);
  return created;
}

async function syncFollowupResponses(handoff, transcript) {
  const updates = [];
  for (const row of handoff.copilotFollowups || []) {
    if (row.status === 'sent' && row.sentAt && !row.responseReceived) {
      if (hasInboundAfter(transcript, row.sentAt)) {
        updates.push(row._id);
      }
    }
  }
  if (!updates.length) return;

  const now = new Date();
  for (const followupId of updates) {
    await WhatsAppAgentHandoff.updateOne(
      { _id: handoff._id, 'copilotFollowups._id': followupId },
      {
        $set: { 'copilotFollowups.$.responseReceived': now },
        $push: {
          auditTrail: buildAuditEntry({
            action: 'followup_replied',
            meta: { followupId: String(followupId) },
          }),
        },
      }
    );
  }
}

function isEligibleForFollowup(ctx) {
  if (ctx.handoff.route !== 'admin_pool') return false;
  const pending = getPendingFollowup(ctx.handoff);
  if (pending) return true;
  if (ctx.daysSinceReply == null) return false;
  return ctx.daysSinceReply >= ctx.inactiveDays;
}

async function ensureFollowupForHandoff(handoff, inactiveDays, { useLlm = false } = {}) {
  const ctx = await loadHandoffContext(handoff, inactiveDays);
  await syncFollowupResponses(handoff, ctx.transcript);

  const refreshed = await WhatsAppAgentHandoff.findById(handoff._id).lean();
  const pending = getPendingFollowup(refreshed);
  if (pending) {
    return mapFollowupDoc(pending, {
      handoffId: refreshed._id,
      phone: refreshed.phone,
      productLine: refreshed.productLine,
      assignedSrCounsellor: refreshed.assignedSrCounsellor,
      lockVersion: refreshed.lockVersion,
    });
  }

  if (!isEligibleForFollowup({ ...ctx, handoff: refreshed })) return null;

  const suggestion = await generateFollowupSuggestion(ctx, { useLlm });
  if (!suggestion) return null;

  const created = await persistFollowupSuggestion(refreshed._id, suggestion);
  return mapFollowupDoc(created, {
    handoffId: refreshed._id,
    phone: refreshed.phone,
    productLine: refreshed.productLine,
    assignedSrCounsellor: refreshed.assignedSrCounsellor,
    lockVersion: refreshed.lockVersion,
  });
}

async function getRecommendedFollowups({ inactiveDays = 3 } = {}) {
  const meta = buildMeta(inactiveDays);
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const handoffs = await WhatsAppAgentHandoff.find({
    route: 'admin_pool',
    updatedAt: { $gte: since },
    status: { $in: ['open', 'claimed', 'resolved'] },
  })
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  const items = [];
  for (const handoff of handoffs) {
    const followup = await ensureFollowupForHandoff(handoff, meta.inactiveDays, { useLlm: false });
    if (followup) items.push(followup);
  }

  const analytics = computeFollowupAnalytics(
    handoffs.flatMap((h) => h.copilotFollowups || [])
  );

  const grouped = {
    high: items.filter((i) => i.priority === 'high'),
    medium: items.filter((i) => i.priority === 'medium'),
    low: items.filter((i) => i.priority === 'low'),
  };

  return { meta, data: { items, grouped, analytics } };
}

async function getFollowupForHandoff(handoffId, { inactiveDays = 3 } = {}) {
  const meta = buildMeta(inactiveDays);
  const handoff = await WhatsAppAgentHandoff.findById(handoffId).lean();
  if (!handoff || handoff.route !== 'admin_pool') return { error: 'not_found' };

  const followup = await ensureFollowupForHandoff(handoff, meta.inactiveDays, { useLlm: true });
  return { meta, data: { followup } };
}

function computeFollowupAnalytics(rows = []) {
  const sent = rows.filter((r) => r.status === 'sent');
  const skipped = rows.filter((r) => r.status === 'skipped');
  const responded = sent.filter((r) => r.responseReceived);
  const byCategory = {};

  for (const row of sent) {
    const key = row.category || 'reconnect';
    if (!byCategory[key]) byCategory[key] = { sent: 0, responded: 0 };
    byCategory[key].sent += 1;
    if (row.responseReceived) byCategory[key].responded += 1;
  }

  const categories = Object.entries(byCategory)
    .map(([key, stats]) => ({
      key,
      sent: stats.sent,
      responded: stats.responded,
      responseRate: stats.sent ? Math.round((stats.responded / stats.sent) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.responseRate - a.responseRate);

  return {
    sentCount: sent.length,
    skippedCount: skipped.length,
    responseRate: sent.length ? Math.round((responded.length / sent.length) * 1000) / 1000 : 0,
    categories,
  };
}

async function sendFollowup(handoffId, adminId, { followupId, message, lockVersion = null } = {}) {
  const handoff = await WhatsAppAgentHandoff.findById(handoffId).lean();
  if (!handoff || handoff.route !== 'admin_pool') return { success: false, error: 'not_found' };

  const followup = (handoff.copilotFollowups || []).find(
    (row) => String(row._id) === String(followupId)
  );
  if (!followup || followup.status !== 'suggested') {
    return { success: false, error: 'followup_not_available' };
  }

  const text = String(message || followup.suggestedMessage || '').trim();
  if (!text) return { success: false, error: 'text_required' };

  const sendResult = await sendCopilotReply(handoffId, adminId, text, { lockVersion });
  if (!sendResult.success) return sendResult;

  const sentAt = new Date();
  await WhatsAppAgentHandoff.updateOne(
    { _id: handoffId, 'copilotFollowups._id': followupId },
    {
      $set: {
        'copilotFollowups.$.status': 'sent',
        'copilotFollowups.$.sentAt': sentAt,
        'copilotFollowups.$.suggestedMessage': text,
        'copilotFollowups.$.adminId': adminId,
        'copilotFollowups.$.replyId': sendResult.replyId,
      },
      $push: {
        auditTrail: buildAuditEntry({
          action: 'followup_sent',
          adminId,
          srCounsellor: handoff.assignedSrCounsellor,
          meta: { followupId: String(followupId), replyId: sendResult.replyId },
        }),
      },
    }
  );

  return {
    success: true,
    deliveryStatus: sendResult.deliveryStatus,
    replyId: sendResult.replyId,
    lockVersion: sendResult.lockVersion,
  };
}

async function skipFollowup(handoffId, adminId, { followupId } = {}) {
  const handoff = await WhatsAppAgentHandoff.findById(handoffId).lean();
  if (!handoff || handoff.route !== 'admin_pool') return { success: false, error: 'not_found' };

  const followup = (handoff.copilotFollowups || []).find(
    (row) => String(row._id) === String(followupId)
  );
  if (!followup || followup.status !== 'suggested') {
    return { success: false, error: 'followup_not_available' };
  }

  const skippedAt = new Date();
  await WhatsAppAgentHandoff.updateOne(
    { _id: handoffId, 'copilotFollowups._id': followupId },
    {
      $set: {
        'copilotFollowups.$.status': 'skipped',
        'copilotFollowups.$.skippedAt': skippedAt,
        'copilotFollowups.$.adminId': adminId,
      },
      $push: {
        auditTrail: buildAuditEntry({
          action: 'followup_skipped',
          adminId,
          srCounsellor: handoff.assignedSrCounsellor,
          meta: { followupId: String(followupId), scenario: followup.scenario },
        }),
      },
    }
  );

  return { success: true, skippedAt };
}

module.exports = {
  FOLLOWUP_CATEGORIES,
  parseInactiveDays,
  daysBetween,
  getLastInboundAt,
  hasInboundAfter,
  detectBookingScenario,
  detectMissedSession,
  detectInactiveScenario,
  detectHotLeadScenario,
  buildRulesFollowup,
  generateFollowupSuggestion,
  getRecommendedFollowups,
  getFollowupForHandoff,
  sendFollowup,
  skipFollowup,
  computeFollowupAnalytics,
  mapFollowupDoc,
};
