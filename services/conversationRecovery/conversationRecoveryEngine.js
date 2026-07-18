'use strict';

const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const {
  getConversationRecoveryConfig,
} = require('./conversationRecoveryConfig');
const {
  evaluateEligibility,
  nextScheduleAt,
} = require('./conversationRecoveryCore');
const {
  logRecoveryEligible,
  logRecoveryScheduled,
} = require('./conversationRecoveryAnalytics');
const { buildIdempotencyKey, CAMPAIGN } = require('./conversationRecoveryIdempotency');

async function upsertCaseFromSnapshot(snapshot, config = getConversationRecoveryConfig()) {
  if (!snapshot) return null;
  const existing = await ConversationRecoveryCase.findOne({
    phone: snapshot.phone,
    conversationId: snapshot.conversationId,
  });

  if (existing && (existing.stopped || existing.paused || existing.status === 'recovered' || existing.status === 'opted_out')) {
    return existing;
  }

  const evaluation = evaluateEligibility(snapshot, existing, config);
  if (!evaluation.eligible) {
    return existing;
  }

  const attemptCount = existing?.attemptCount || 0;
  const nextAttemptNumber = attemptCount + 1;
  const scheduledFor = nextScheduleAt(
    snapshot.lastActivityAt,
    nextAttemptNumber,
    config
  );

  const caseDoc = await ConversationRecoveryCase.findOneAndUpdate(
    { phone: snapshot.phone, conversationId: snapshot.conversationId },
    {
      $set: {
        snapshotId: snapshot._id,
        status: 'scheduled',
        maxAttempts: config.maxAttempts,
        nextAttemptAt: scheduledFor,
        lastPhase: snapshot.lastPhase,
        lastStage: snapshot.lastStage,
        paused: false,
        stopped: false,
      },
      $setOnInsert: {
        attemptCount: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logRecoveryEligible({
    phoneTail: String(snapshot.phone).slice(-4),
    lastPhase: snapshot.lastPhase,
    conversationId: String(snapshot.conversationId),
  });

  const idempotencyKey = buildIdempotencyKey(
    snapshot.conversationId,
    nextAttemptNumber,
    CAMPAIGN
  );
  const existingAttempt = await ConversationRecoveryAttempt.findOne({
    $or: [
      { caseId: caseDoc._id, attemptNumber: nextAttemptNumber },
      { idempotencyKey },
    ],
  });
  if (!existingAttempt) {
    try {
      await ConversationRecoveryAttempt.create({
        caseId: caseDoc._id,
        phone: snapshot.phone,
        conversationId: snapshot.conversationId,
        attemptNumber: nextAttemptNumber,
        idempotencyKey,
        campaign: CAMPAIGN,
        scheduledFor,
        lastPhase: snapshot.lastPhase,
        deliveryStatus: 'queued',
        queuedAt: new Date(),
      });
      logRecoveryScheduled({
        phoneTail: String(snapshot.phone).slice(-4),
        attemptNumber: nextAttemptNumber,
        scheduledFor,
      });
    } catch (err) {
      // Duplicate key = concurrent scheduler already created attempt — safe to skip
      if (!(err && (err.code === 11000 || String(err.message || '').includes('E11000')))) {
        throw err;
      }
    }
  }

  return caseDoc;
}

/**
 * Scan snapshots that look eligible and schedule recovery cases/attempts.
 */
async function runEligibilityScan({ limit = 200, now = new Date() } = {}) {
  const config = getConversationRecoveryConfig();
  if (!config.featureEnabled) {
    return { scanned: 0, scheduled: 0, skipped: 0 };
  }

  const minInactiveMs =
    Math.min(...(config.intervalsHours || [24])) * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - minInactiveMs);

  const snapshots = await ConversationRecoverySnapshot.find({
    journeyCompleted: false,
    bookingCompleted: false,
    optedOut: false,
    recoveryEligibleHint: true,
    lastActivityAt: { $lte: cutoff },
  })
    .sort({ lastActivityAt: 1 })
    .limit(limit)
    .lean();

  let scheduled = 0;
  let skipped = 0;
  for (const snap of snapshots) {
    const existing = await ConversationRecoveryCase.findOne({
      phone: snap.phone,
      conversationId: snap.conversationId,
    }).lean();
    const evaluation = evaluateEligibility(snap, existing, config, now);
    if (!evaluation.eligible) {
      skipped += 1;
      continue;
    }
    await upsertCaseFromSnapshot(snap, config);
    scheduled += 1;
  }

  return { scanned: snapshots.length, scheduled, skipped };
}

module.exports = {
  upsertCaseFromSnapshot,
  runEligibilityScan,
};
