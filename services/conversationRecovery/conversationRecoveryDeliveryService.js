'use strict';

const crypto = require('crypto');
const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');
const {
  getConversationRecoveryConfig,
} = require('./conversationRecoveryConfig');
const {
  buildRecoveryMessage,
  buildTemplateParams,
} = require('./conversationRecoveryMessageGenerator');
const {
  logRecoverySent,
  logRecoveryFailed,
  logRecoveryDelivered,
  logRecoveryRead,
} = require('./conversationRecoveryAnalytics');

function toE164(phone10) {
  const d = String(phone10 || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return d;
}

function classifySendFailure(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (/template_not_configured|template missing|template_missing/.test(msg)) {
    return 'template_missing';
  }
  if (/reject|not approved|template.*fail/.test(msg)) return 'template_rejected';
  if (/invalid|not a valid/.test(msg)) return 'invalid_number';
  if (/block|opt.?out|unsubscribe/.test(msg)) return 'blocked';
  if (/template/.test(msg)) return 'template_failure';
  if (/rate.?limit|429/.test(msg)) return 'rate_limit';
  if (/api|gupshup|network|timeout|5\d\d/.test(msg)) return 'api_failure';
  return 'unknown';
}

/**
 * Send one claimed recovery attempt.
 * Uses Gupshup template when configured; otherwise records template_failure (no fake success).
 */
async function sendRecoveryAttempt(attempt, { sendFn = null } = {}) {
  const {
    isAttemptAlreadyProcessed,
  } = require('./conversationRecoveryIdempotency');
  if (isAttemptAlreadyProcessed(attempt)) {
    return {
      ok: true,
      attemptId: attempt._id,
      gupshupMessageId: attempt.gupshupMessageId || null,
      skipped: true,
      reason: 'already_processed',
    };
  }

  const config = getConversationRecoveryConfig();
  const snapshot = await ConversationRecoverySnapshot.findOne({
    conversationId: attempt.conversationId,
  }).lean();

  const messageBody = buildRecoveryMessage({
    lastPhase: attempt.lastPhase || snapshot?.lastPhase,
    studentName: snapshot?.studentName,
  });
  const params = buildTemplateParams({
    lastPhase: attempt.lastPhase || snapshot?.lastPhase,
    studentName: snapshot?.studentName,
  });

  await ConversationRecoveryAttempt.updateOne(
    { _id: attempt._id },
    {
      $set: {
        messageBody,
        templateId: config.templateId,
        deliveryStatus: 'queued',
        queuedAt: new Date(),
      },
    }
  );

  const customSend = typeof sendFn === 'function' ? sendFn : null;

  try {
    let providerResult = null;
    if (customSend) {
      providerResult = await customSend({
        phone: attempt.phone,
        phoneE164: toE164(attempt.phone),
        templateId: config.templateId,
        params,
        messageBody,
        attempt,
      });
    } else if (config.templateId) {
      const gupshupService = require('../gupshupService');
      providerResult = await gupshupService.sendTemplateMessage(
        toE164(attempt.phone),
        config.templateId,
        params,
        { messageKind: config.messageKind }
      );
      if (providerResult && providerResult.success === false) {
        throw new Error(providerResult.error || 'gupshup_send_failed');
      }
    } else {
      throw new Error('template_not_configured');
    }

    const gupshupMessageId =
      providerResult?.gupshupMessageId ||
      providerResult?.messageId ||
      providerResult?.data?.messageId ||
      null;

    await ConversationRecoveryAttempt.updateOne(
      { _id: attempt._id },
      {
        $set: {
          deliveryStatus: 'sent',
          sentAt: new Date(),
          gupshupMessageId: gupshupMessageId ? String(gupshupMessageId) : null,
          failureReason: null,
        },
      }
    );
    await ConversationRecoveryCase.updateOne(
      { _id: attempt.caseId },
      {
        $set: {
          status: 'awaiting_reply',
          lastAttemptAt: new Date(),
          nextAttemptAt: null,
        },
        $inc: { attemptCount: 0 },
      }
    );
    // attemptCount already incremented when attempt was claimed
    logRecoverySent({
      phoneTail: String(attempt.phone).slice(-4),
      attemptNumber: attempt.attemptNumber,
      lastPhase: attempt.lastPhase,
    });
    return { ok: true, attemptId: attempt._id, gupshupMessageId };
  } catch (err) {
    const failureReason =
      String(err?.message || '').includes('template_not_configured')
        ? 'template_missing'
        : classifySendFailure(err);
    await ConversationRecoveryAttempt.updateOne(
      { _id: attempt._id },
      {
        $set: {
          deliveryStatus: 'failed',
          failedAt: new Date(),
          failureReason,
        },
      }
    );
    logRecoveryFailed({
      phoneTail: String(attempt.phone).slice(-4),
      attemptNumber: attempt.attemptNumber,
      failureReason,
    });
    return { ok: false, attemptId: attempt._id, failureReason };
  }
}

async function applyDeliveryStatusToAttempt({
  gupshupMessageId,
  status,
  at = new Date(),
} = {}) {
  if (!gupshupMessageId || !status) return null;
  const attempt = await ConversationRecoveryAttempt.findOne({
    gupshupMessageId: String(gupshupMessageId),
  });
  if (!attempt) return null;

  const patch = {};
  const normalized = String(status).toLowerCase();
  if (normalized === 'delivered') {
    patch.deliveryStatus = 'delivered';
    patch.deliveredAt = at;
  } else if (normalized === 'read') {
    patch.deliveryStatus = 'read';
    patch.readAt = at;
    if (!attempt.deliveredAt) patch.deliveredAt = at;
  } else if (normalized === 'failed') {
    patch.deliveryStatus = 'failed';
    patch.failedAt = at;
    patch.failureReason = attempt.failureReason || 'unknown';
  } else if (normalized === 'sent') {
    patch.deliveryStatus = 'sent';
    patch.sentAt = attempt.sentAt || at;
  } else {
    return attempt;
  }

  await ConversationRecoveryAttempt.updateOne({ _id: attempt._id }, { $set: patch });
  const updated = await ConversationRecoveryAttempt.findById(attempt._id);
  if (normalized === 'delivered') {
    logRecoveryDelivered({
      phoneTail: String(attempt.phone).slice(-4),
      attemptNumber: attempt.attemptNumber,
    });
  } else if (normalized === 'read') {
    logRecoveryRead({
      phoneTail: String(attempt.phone).slice(-4),
      attemptNumber: attempt.attemptNumber,
    });
  }
  return updated;
}

function newClaimToken() {
  return crypto.randomBytes(12).toString('hex');
}

module.exports = {
  sendRecoveryAttempt,
  applyDeliveryStatusToAttempt,
  toE164,
  classifySendFailure,
  newClaimToken,
};
