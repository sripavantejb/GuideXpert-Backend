'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const whatsappOutbound = require('../whatsappOutboundService');
const { claimHandoff } = require('../handoffService');
const { buildAuditEntry } = require('./humanCopilotAuditService');
const { canTransitionCopilotState } = require('./humanCopilotConstants');
const { enrichReplyLearning } = require('./humanCopilotLearningService');

function normalizeSuggestedText(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      const trimmed = value.text.trim();
      return trimmed || null;
    }
    if (typeof value.suggestedMessage === 'string') {
      const trimmed = value.suggestedMessage.trim();
      return trimmed || null;
    }
  }
  return null;
}

function classifyReplySource({ text, suggestedText }) {
  const draft = String(text || '').trim();
  const suggested = String(normalizeSuggestedText(suggestedText) || '').trim();
  if (!suggested) return 'manual';
  if (draft === suggested) return 'ai_used';
  return 'ai_edited';
}

async function assertReplyOwnership(handoff, adminId) {
  if (!handoff) return { ok: false, error: 'not_found' };
  if (handoff.route !== 'admin_pool') return { ok: false, error: 'not_copilot_handoff' };
  if (!['open', 'claimed'].includes(handoff.status)) {
    return { ok: false, error: 'handoff_closed' };
  }
  if (
    handoff.activeAdminId &&
    String(handoff.activeAdminId) !== String(adminId) &&
    handoff.assignedSrCounsellor
  ) {
    return {
      ok: false,
      error: 'already_assigned',
      assignedSrCounsellor: handoff.assignedSrCounsellor,
      lockVersion: handoff.lockVersion,
    };
  }
  return { ok: true };
}

async function updateReplyStatus(handoffId, replySubId, patch, extraSet = {}) {
  const set = {};
  for (const [key, value] of Object.entries(patch)) {
    set[`copilotReplies.$.${key}`] = value;
  }
  for (const [key, value] of Object.entries(extraSet)) {
    set[key] = value;
  }
  return WhatsAppAgentHandoff.findOneAndUpdate(
    { _id: handoffId, 'copilotReplies._id': replySubId },
    { $set: set },
    { new: true }
  ).lean();
}

async function sendCopilotReply(
  handoffId,
  adminId,
  text,
  { lockVersion = null, suggestedText = null, replySource = null, retryReplyId = null } = {}
) {
  const handoff = await WhatsAppAgentHandoff.findById(handoffId).lean();
  const ownership = await assertReplyOwnership(handoff, adminId);
  if (!ownership.ok) {
    return { success: false, ...ownership };
  }

  const draftText = String(text || '').trim();
  if (!draftText) return { success: false, error: 'text_required' };

  const normalizedSuggestedText = normalizeSuggestedText(suggestedText);
  const source = replySource || classifyReplySource({ text: draftText, suggestedText: normalizedSuggestedText });
  const now = new Date();
  let replySubId = retryReplyId;
  let nextLockVersion = handoff.lockVersion;

  if (retryReplyId) {
    const existing = (handoff.copilotReplies || []).find(
      (r) => String(r._id) === String(retryReplyId)
    );
    if (!existing || existing.status !== 'failed') {
      return { success: false, error: 'retry_not_available' };
    }
    const filter = { _id: handoffId, 'copilotReplies._id': retryReplyId };
    if (lockVersion != null) filter.lockVersion = lockVersion;

    const retryUpdated = await WhatsAppAgentHandoff.findOneAndUpdate(
      filter,
      {
        $set: {
          'copilotReplies.$.status': 'sending',
          'copilotReplies.$.errorMessage': null,
          'copilotReplies.$.draftText': draftText,
          activeAdminId: adminId,
          copilotState: 'active',
        },
        $inc: { lockVersion: 1 },
        $push: {
          auditTrail: buildAuditEntry({
            action: 'reply_retried',
            adminId,
            srCounsellor: handoff.assignedSrCounsellor,
            meta: { replyId: String(retryReplyId) },
          }),
        },
      },
      { new: true }
    ).lean();

    if (!retryUpdated) {
      const current = await WhatsAppAgentHandoff.findById(handoffId).lean();
      if (lockVersion != null && current?.lockVersion !== lockVersion) {
        return { success: false, error: 'version_conflict', lockVersion: current?.lockVersion };
      }
      return { success: false, error: 'retry_failed' };
    }
    nextLockVersion = retryUpdated.lockVersion;
  } else {
    const filter = {
      _id: handoffId,
      route: 'admin_pool',
      status: { $in: ['open', 'claimed'] },
    };
    if (lockVersion != null) filter.lockVersion = lockVersion;

    const replyDoc = {
      draftText,
      status: 'sending',
      adminId,
      suggestedText: normalizedSuggestedText,
      replySource: source,
      createdAt: now,
    };

    const created = await WhatsAppAgentHandoff.findOneAndUpdate(
      filter,
      {
        $push: {
          copilotReplies: replyDoc,
          auditTrail: buildAuditEntry({
            action: 'replied',
            adminId,
            srCounsellor: handoff.assignedSrCounsellor,
            meta: { phase: 'sending', replySource: source },
          }),
        },
        $set: {
          activeAdminId: adminId,
          copilotState: canTransitionCopilotState(handoff.copilotState, 'active')
            ? 'active'
            : 'active',
          status: 'claimed',
          claimedAt: handoff.claimedAt || now,
        },
        $inc: { lockVersion: 1 },
      },
      { new: true }
    ).lean();

    if (!created) {
      const current = await WhatsAppAgentHandoff.findById(handoffId).lean();
      if (current?.activeAdminId && String(current.activeAdminId) !== String(adminId)) {
        return {
          success: false,
          error: 'already_assigned',
          assignedSrCounsellor: current.assignedSrCounsellor,
          lockVersion: current?.lockVersion,
        };
      }
      if (lockVersion != null && current?.lockVersion !== lockVersion) {
        return { success: false, error: 'version_conflict', lockVersion: current?.lockVersion };
      }
      return { success: false, error: 'send_failed' };
    }

    replySubId = created.copilotReplies[created.copilotReplies.length - 1]._id;
    nextLockVersion = created.lockVersion;
  }

  await claimHandoff(handoffId, { adminId });

  const sendResult = await whatsappOutbound.sendAgentTextReply({
    conversationId: handoff.conversationId,
    phone10: handoff.phone,
    text: draftText,
    senderAdminId: adminId,
    handoffId: handoff._id,
  });

  const sentAt = new Date();
  if (sendResult.success) {
    const providerStatus = sendResult.providerStatus || (sendResult.stub ? 'simulated' : 'submitted');
    const deliveryStatus = sendResult.deliveryStatus || providerStatus;
    const replyStatus = providerStatus === 'simulated' ? 'simulated' : 'sent';
    const firstResponseAt = handoff.firstResponseAt || sentAt;
    const learning = enrichReplyLearning({
      suggestedText: normalizedSuggestedText,
      draftText,
      replySource: source,
    });
    await updateReplyStatus(
      handoffId,
      replySubId,
      {
        status: replyStatus,
        sentAt: providerStatus === 'simulated' ? null : sentAt,
        outboundMessageId: sendResult.outboundId,
        errorMessage: providerStatus === 'simulated' ? 'WA_INTEGRATION_STUB' : null,
        editRatio: learning.editRatio,
        editClassification: learning.editClassification,
        editTopic: learning.editTopic,
        editPatterns: learning.editPatterns,
      },
      providerStatus === 'simulated'
        ? {}
        : {
            lastAgentMessageAt: sentAt,
            repliedByAdminId: adminId,
            repliedAt: sentAt,
            firstResponseAt,
            copilotState: 'active',
            status: 'claimed',
          }
    );
    return {
      success: true,
      deliveryStatus,
      providerStatus,
      replyId: String(replySubId),
      outboundMessageId: sendResult.outboundId ? String(sendResult.outboundId) : null,
      lockVersion: nextLockVersion + 0,
      replySource: source,
      sessionFallback: Boolean(sendResult.sessionFallback),
      errorMessage: providerStatus === 'simulated' ? 'WA_INTEGRATION_STUB' : null,
    };
  }

  const failMessage = String(sendResult.error || sendResult.message || 'send_failed').slice(0, 500);
  await updateReplyStatus(
    handoffId,
    replySubId,
    {
      status: 'failed',
      failedAt: sentAt,
      errorMessage: failMessage,
    },
    {}
  );
  await WhatsAppAgentHandoff.updateOne(
    { _id: handoffId },
    {
      $push: {
        auditTrail: buildAuditEntry({
          action: 'reply_failed',
          adminId,
          srCounsellor: handoff.assignedSrCounsellor,
          meta: { replyId: String(replySubId), error: failMessage },
        }),
      },
    }
  );

  return {
    success: false,
    error: 'send_failed',
    deliveryStatus: 'failed',
    providerStatus: 'failed',
    replyId: String(replySubId),
    message: failMessage,
    errorMessage: failMessage,
    draftText,
    lockVersion: nextLockVersion,
  };
}

module.exports = {
  sendCopilotReply,
  assertReplyOwnership,
  classifyReplySource,
  normalizeSuggestedText,
};
