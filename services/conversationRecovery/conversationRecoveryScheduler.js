'use strict';

const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoverySchedulerRun = require('../../models/ConversationRecoverySchedulerRun');
const {
  getConversationRecoveryConfig,
} = require('./conversationRecoveryConfig');
const { runEligibilityScan } = require('./conversationRecoveryEngine');
const {
  sendRecoveryAttempt,
  newClaimToken,
} = require('./conversationRecoveryDeliveryService');
const {
  buildIdempotencyKey,
  isAttemptAlreadyProcessed,
  CAMPAIGN,
} = require('./conversationRecoveryIdempotency');
const { evaluateSendWindow } = require('./conversationRecoveryOpsWindow');
const {
  evaluateAndUpsertAlerts,
} = require('./conversationRecoveryAlertService');
const { recordSystemMetricSample } = require('./conversationRecoveryMetrics');
const { countSentToday } = require('./conversationRecoveryDailyCounts');

/**
 * Claim due queued attempts and send them (idempotent + window-aware).
 */
async function dispatchDueAttempts({ limit = 50, now = new Date(), sendFn = null } = {}) {
  const config = getConversationRecoveryConfig();
  if (!config.featureEnabled) {
    return {
      claimed: 0,
      sent: 0,
      failed: 0,
      skippedIdempotent: 0,
      skippedWindow: 0,
      skippedDailyLimit: 0,
    };
  }

  const window = evaluateSendWindow(config, now);
  if (!window.allowed) {
    return {
      claimed: 0,
      sent: 0,
      failed: 0,
      skippedIdempotent: 0,
      skippedWindow: 1,
      skippedDailyLimit: 0,
      windowReasons: window.reasons,
    };
  }

  let dailySent = await countSentToday(now);
  const dailyLimit = Number(config.dailySendLimit) || 0;

  const due = await ConversationRecoveryAttempt.find({
    deliveryStatus: 'queued',
    scheduledFor: { $lte: now },
    claimedAt: null,
    sentAt: null,
  })
    .sort({ scheduledFor: 1 })
    .limit(limit);

  let claimedCount = 0;
  let sent = 0;
  let failed = 0;
  let skippedIdempotent = 0;
  let skippedDailyLimit = 0;

  for (const attempt of due) {
    if (dailyLimit > 0 && dailySent >= dailyLimit) {
      skippedDailyLimit += 1;
      continue;
    }

    if (isAttemptAlreadyProcessed(attempt)) {
      skippedIdempotent += 1;
      continue;
    }

    const caseDoc = await ConversationRecoveryCase.findById(attempt.caseId);
    if (!caseDoc || caseDoc.paused || caseDoc.stopped) {
      continue;
    }
    if (caseDoc.attemptCount >= caseDoc.maxAttempts) {
      await ConversationRecoveryCase.updateOne(
        { _id: caseDoc._id },
        { $set: { status: 'exhausted', nextAttemptAt: null } }
      );
      continue;
    }

    const token = newClaimToken();
    const claimed = await ConversationRecoveryAttempt.findOneAndUpdate(
      {
        _id: attempt._id,
        claimedAt: null,
        deliveryStatus: 'queued',
        sentAt: null,
      },
      {
        $set: {
          claimedAt: now,
          claimToken: token,
          processingStartedAt: now,
          idempotencyKey:
            attempt.idempotencyKey ||
            buildIdempotencyKey(attempt.conversationId, attempt.attemptNumber, CAMPAIGN),
          campaign: attempt.campaign || CAMPAIGN,
        },
      },
      { new: true }
    );
    if (!claimed) {
      skippedIdempotent += 1;
      continue;
    }
    claimedCount += 1;

    // Double-check another worker didn't complete this idempotency key
    const prior = await ConversationRecoveryAttempt.findOne({
      idempotencyKey: claimed.idempotencyKey,
      _id: { $ne: claimed._id },
      deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
    }).lean();
    if (prior || isAttemptAlreadyProcessed(claimed)) {
      skippedIdempotent += 1;
      continue;
    }

    await ConversationRecoveryCase.updateOne(
      { _id: caseDoc._id },
      {
        $set: { status: 'active', lastAttemptAt: now },
        $inc: { attemptCount: 1 },
      }
    );

    const result = await sendRecoveryAttempt(claimed, { sendFn });
    if (result.ok) {
      sent += 1;
      dailySent += 1;
    } else {
      failed += 1;
    }

    const refreshed = await ConversationRecoveryCase.findById(caseDoc._id);
    if (
      !result.ok &&
      refreshed &&
      refreshed.attemptCount < refreshed.maxAttempts &&
      !refreshed.stopped
    ) {
      const nextNum = refreshed.attemptCount + 1;
      const intervals = config.intervalsHours || [24, 72, 168];
      const hours = intervals[Math.min(nextNum - 1, intervals.length - 1)] || 24;
      const scheduledFor = new Date(now.getTime() + hours * 60 * 60 * 1000);
      const nextKey = buildIdempotencyKey(refreshed.conversationId, nextNum, CAMPAIGN);
      try {
        await ConversationRecoveryAttempt.findOneAndUpdate(
          { caseId: refreshed._id, attemptNumber: nextNum },
          {
            $setOnInsert: {
              phone: refreshed.phone,
              conversationId: refreshed.conversationId,
              attemptNumber: nextNum,
              idempotencyKey: nextKey,
              campaign: CAMPAIGN,
              scheduledFor,
              lastPhase: refreshed.lastPhase,
              deliveryStatus: 'queued',
              queuedAt: now,
            },
          },
          { upsert: true }
        );
      } catch (err) {
        if (!(err && err.code === 11000)) throw err;
      }
      await ConversationRecoveryCase.updateOne(
        { _id: refreshed._id },
        { $set: { status: 'scheduled', nextAttemptAt: scheduledFor } }
      );
    } else if (refreshed && refreshed.attemptCount >= refreshed.maxAttempts && !result.ok) {
      await ConversationRecoveryCase.updateOne(
        { _id: refreshed._id },
        { $set: { status: 'exhausted', nextAttemptAt: null } }
      );
    }
  }

  return {
    claimed: claimedCount,
    sent,
    failed,
    skippedIdempotent,
    skippedWindow: 0,
    skippedDailyLimit,
  };
}

async function runConversationRecoveryCron(opts = {}) {
  const startedAt = new Date();
  let runDoc = null;
  try {
    runDoc = await ConversationRecoverySchedulerRun.create({
      startedAt,
      trigger: opts.trigger || 'cron',
    });
  } catch (_) {
    // health still works without run trail
  }

  const scan = await runEligibilityScan({
    limit: opts.scanLimit || 200,
    now: opts.now,
  });
  const dispatch = await dispatchDueAttempts({
    limit: opts.dispatchLimit || 50,
    now: opts.now,
    sendFn: opts.sendFn,
  });

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const payload = { scan, dispatch, durationMs };

  if (runDoc) {
    await ConversationRecoverySchedulerRun.updateOne(
      { _id: runDoc._id },
      {
        $set: {
          finishedAt,
          durationMs,
          success: true,
          scanned: scan.scanned || 0,
          scheduled: scan.scheduled || 0,
          claimed: dispatch.claimed || 0,
          sent: dispatch.sent || 0,
          failed: dispatch.failed || 0,
          skippedIdempotent: dispatch.skippedIdempotent || 0,
          skippedWindow: dispatch.skippedWindow || 0,
          skippedDailyLimit: dispatch.skippedDailyLimit || 0,
        },
      }
    ).catch(() => {});
  }

  recordSystemMetricSample({
    type: 'scheduler_run',
    durationMs,
    sent: dispatch.sent || 0,
    failed: dispatch.failed || 0,
  });

  try {
    await evaluateAndUpsertAlerts({ now: finishedAt });
  } catch (_) {
    // never fail cron on alerts
  }

  return payload;
}

module.exports = {
  dispatchDueAttempts,
  runConversationRecoveryCron,
};
