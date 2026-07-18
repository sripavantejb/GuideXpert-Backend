'use strict';

const mongoose = require('mongoose');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');
const botStateService = require('../chatbot/botStateService');
const { emptySubflows } = require('../chatbot/botSubflowContext');
const {
  getConversationRecoveryConfig,
} = require('./conversationRecoveryConfig');
const { isRecoveryOptOutText } = require('./conversationRecoveryCore');
const {
  logRecoveryOptOut,
  logRecoveryReplied,
  logConversationResumed,
  logJourneyResumed,
  logJourneyCompletedAfterRecovery,
  logBookingCompletedAfterRecovery,
  logRecoveryStopped,
} = require('./conversationRecoveryAnalytics');

/**
 * Before TTL wipe: restore journey from snapshot when student replies to recovery.
 * Returns { restored: true, context } or { restored: false }.
 */
async function tryResumeFromRecovery({
  phone,
  conversationId,
  inboundText,
  botState,
} = {}) {
  const config = getConversationRecoveryConfig();
  if (!config.featureEnabled || !phone || !conversationId) {
    return { restored: false };
  }
  if (mongoose.connection?.readyState !== 1) {
    return { restored: false };
  }

  const caseDoc = await ConversationRecoveryCase.findOne({
    phone: String(phone),
    conversationId,
  });

  if (!caseDoc) return { restored: false };
  if (caseDoc.stopped || caseDoc.status === 'opted_out') return { restored: false };
  if (caseDoc.paused) return { restored: false };

  const recentSent = await ConversationRecoveryAttempt.findOne({
    caseId: caseDoc._id,
    deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
  })
    .sort({ sentAt: -1 })
    .lean();

  const isAwaiting =
    caseDoc.status === 'awaiting_reply' ||
    caseDoc.status === 'active';
  const needsRehydrate =
    caseDoc.status === 'recovered' &&
    (!botState ||
      botState.state !== 'career_counselling_v2' ||
      !botState.context?.careerCounselling);

  if (!isAwaiting && !needsRehydrate) {
    return { restored: false };
  }
  if (!recentSent && caseDoc.status !== 'awaiting_reply') {
    return { restored: false };
  }

  if (isRecoveryOptOutText(inboundText)) {
    await ConversationRecoveryCase.updateOne(
      { _id: caseDoc._id },
      {
        $set: {
          status: 'opted_out',
          stopped: true,
          stopReason: 'user_opt_out',
          nextAttemptAt: null,
        },
      }
    );
    logRecoveryOptOut({
      phoneTail: String(phone).slice(-4),
      conversationId: String(conversationId),
    });
    return { restored: false, optedOut: true };
  }

  const snapshot = await ConversationRecoverySnapshot.findById(caseDoc.snapshotId).lean();
  if (!snapshot?.journeyBlob || typeof snapshot.journeyBlob !== 'object') {
    return { restored: false };
  }

  const journey = snapshot.journeyBlob;
  const baseContext = emptySubflows();
  const nextContext = {
    ...baseContext,
    ...(botState?.context && typeof botState.context === 'object' ? botState.context : {}),
    careerCounselling: journey,
  };

  await botStateService.transitionState(
    conversationId,
    phone,
    'career_counselling_v2',
    nextContext,
    {
      reason: 'conversation_recovery_resume',
      ttlMs: 30 * 60 * 1000,
    }
  );

  if (caseDoc.status !== 'recovered') {
    await ConversationRecoveryCase.updateOne(
      { _id: caseDoc._id },
      {
        $set: {
          status: 'recovered',
          recoveredAt: new Date(),
          nextAttemptAt: null,
        },
      }
    );
    await ConversationRecoveryAttempt.updateOne(
      { _id: recentSent?._id },
      { $set: { repliedAt: new Date() } }
    ).catch(() => {});

    logRecoveryReplied({
      phoneTail: String(phone).slice(-4),
      lastPhase: snapshot.lastPhase,
    });
    logConversationResumed({
      phoneTail: String(phone).slice(-4),
      lastStage: snapshot.lastStage,
    });
    logJourneyResumed({
      phoneTail: String(phone).slice(-4),
      lastPhase: snapshot.lastPhase,
    });
  }

  return {
    restored: true,
    context: nextContext,
    lastStage: snapshot.lastStage,
    lastPhase: snapshot.lastPhase,
  };
}

async function markPostRecoveryOutcomesFromSnapshot(snapshot) {
  if (!snapshot) return;
  const caseDoc = await ConversationRecoveryCase.findOne({
    phone: snapshot.phone,
    conversationId: snapshot.conversationId,
    status: 'recovered',
  });
  if (!caseDoc) return;

  if (snapshot.journeyCompleted && !caseDoc.journeyCompletedAfterRecovery) {
    await ConversationRecoveryCase.updateOne(
      { _id: caseDoc._id },
      { $set: { journeyCompletedAfterRecovery: true } }
    );
    logJourneyCompletedAfterRecovery({
      phoneTail: String(snapshot.phone).slice(-4),
    });
  }
  if (snapshot.bookingCompleted && !caseDoc.bookingCompletedAfterRecovery) {
    await ConversationRecoveryCase.updateOne(
      { _id: caseDoc._id },
      { $set: { bookingCompletedAfterRecovery: true } }
    );
    logBookingCompletedAfterRecovery({
      phoneTail: String(snapshot.phone).slice(-4),
    });
  }
}

async function pauseCase(caseId) {
  const doc = await ConversationRecoveryCase.findByIdAndUpdate(
    caseId,
    { $set: { paused: true, status: 'paused' } },
    { new: true }
  );
  return doc;
}

async function resumeCase(caseId) {
  const caseDoc = await ConversationRecoveryCase.findById(caseId);
  if (!caseDoc || caseDoc.stopped || caseDoc.status === 'opted_out') return null;
  return ConversationRecoveryCase.findByIdAndUpdate(
    caseId,
    {
      $set: {
        paused: false,
        status: caseDoc.nextAttemptAt ? 'scheduled' : 'eligible',
      },
    },
    { new: true }
  );
}

async function stopCase(caseId, reason = 'admin_stop') {
  const doc = await ConversationRecoveryCase.findByIdAndUpdate(
    caseId,
    {
      $set: {
        stopped: true,
        status: 'stopped',
        stopReason: reason,
        nextAttemptAt: null,
      },
    },
    { new: true }
  );
  logRecoveryStopped({ caseId: String(caseId), reason });
  return doc;
}

async function rescheduleCase(caseId, { scheduledFor = new Date() } = {}) {
  const caseDoc = await ConversationRecoveryCase.findById(caseId);
  if (!caseDoc || caseDoc.stopped) return null;
  if (caseDoc.attemptCount >= caseDoc.maxAttempts) return null;

  const {
    buildIdempotencyKey,
    CAMPAIGN,
  } = require('./conversationRecoveryIdempotency');
  const nextNum = caseDoc.attemptCount + 1;
  const idempotencyKey = buildIdempotencyKey(
    caseDoc.conversationId,
    nextNum,
    CAMPAIGN
  );
  await ConversationRecoveryAttempt.findOneAndUpdate(
    { caseId: caseDoc._id, attemptNumber: nextNum },
    {
      $set: {
        phone: caseDoc.phone,
        conversationId: caseDoc.conversationId,
        attemptNumber: nextNum,
        idempotencyKey,
        campaign: CAMPAIGN,
        scheduledFor,
        lastPhase: caseDoc.lastPhase,
        deliveryStatus: 'queued',
        queuedAt: new Date(),
        claimedAt: null,
        claimToken: null,
        failureReason: null,
        sentAt: null,
        gupshupMessageId: null,
        processingStartedAt: null,
      },
    },
    { upsert: true, new: true }
  );
  return ConversationRecoveryCase.findByIdAndUpdate(
    caseId,
    {
      $set: {
        paused: false,
        status: 'scheduled',
        nextAttemptAt: scheduledFor,
      },
    },
    { new: true }
  );
}

module.exports = {
  tryResumeFromRecovery,
  markPostRecoveryOutcomesFromSnapshot,
  pauseCase,
  resumeCase,
  stopCase,
  rescheduleCase,
};
