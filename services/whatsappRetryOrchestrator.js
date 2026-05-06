const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const FormSubmission = require('../models/FormSubmission');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const {
  sendSlotBookedWhatsApp,
  sendPre4HrReminderWhatsApp,
  sendMeetLinkWhatsApp,
  sendReminder30MinWhatsApp
} = require('./gupshupService');
const {
  TERMINAL_FAILURE_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  filterRetryPromotionRows,
  isCampaignStrategy,
  getRetryPolicy,
  retryCooldownMsForKind,
  isRetryableFailure
} = require('../utils/whatsappRetryRules');

function cooldownMs() {
  const min = parseInt(process.env.WHATSAPP_RETRY_COOLDOWN_MINUTES || '5', 10);
  return (Number.isFinite(min) && min >= 0 ? min : 5) * 60 * 1000;
}

function sendFnForKind(kind) {
  switch (kind) {
    case 'slot_booked':
      return sendSlotBookedWhatsApp;
    case 'pre4hr':
      return sendPre4HrReminderWhatsApp;
    case 'meet':
      return sendMeetLinkWhatsApp;
    case '30min':
      return sendReminder30MinWhatsApp;
    default:
      return null;
  }
}

/**
 * @param {mongoose.Types.ObjectId|string} retryGroupId
 * @param {1|2} fromAttempt failures at this slice feed the next promotion
 * @returns {Promise<{ candidateCount: number, candidates: { phone: string, parentMessageEventId: mongoose.Types.ObjectId }[], excludedReasons?: object }>}
 */
async function computeRetryCandidates(retryGroupId, fromAttempt) {
  const gid = new mongoose.Types.ObjectId(String(retryGroupId));
  const fa = fromAttempt === 2 ? 2 : 1;
  const nextAttempt = fa + 1;
  const group = await WhatsAppRetryGroup.findById(gid).select('messageKind').lean();
  if (!group || !isCampaignStrategy(group.messageKind)) {
    return { candidateCount: 0, candidates: [], excludedReasons: { nonCampaignOrMissingGroup: true } };
  }

  const [neverRetryPhones, alreadyNextPhones, rawFailed] = await Promise.all([
    WhatsAppMessageEvent.distinct('phone', {
      retryGroupId: gid,
      status: { $in: SUCCESS_TERMINAL_STATUSES }
    }),
    WhatsAppMessageEvent.distinct('phone', {
      retryGroupId: gid,
      attemptNumber: nextAttempt
    }),
    WhatsAppMessageEvent.find({
      retryGroupId: gid,
      attemptNumber: fa,
      status: { $in: TERMINAL_FAILURE_STATUSES }
    })
      .select('phone failedAt updatedAt createdAt retryEligible _id')
      .lean()
  ]);

  const filtered = filterRetryPromotionRows(rawFailed, {
    neverRetryPhones,
    alreadyPromotedPhones: alreadyNextPhones,
    cooldownCutoffMs: retryCooldownMsForKind(group.messageKind) || cooldownMs()
  });

  const candidates = filtered.map((r) => ({
    phone: r.phone,
    parentMessageEventId: r._id
  }));

  return {
    candidateCount: candidates.length,
    candidates,
    excludedReasons: {
      phonesDeliveredOrRead: neverRetryPhones.length,
      phonesAlreadyAtNextAttempt: alreadyNextPhones.length,
      rawFailuresBeforeRules: rawFailed.length
    }
  };
}

/**
 * @param {object} opts
 * @param {mongoose.Types.ObjectId|string} opts.retryGroupId
 * @param {2|3} opts.nextAttempt
 * @param {mongoose.Types.ObjectId} [opts.attemptBatchId]
 * @param {'retry_cron'|'retry_api'} opts.source
 * @param {mongoose.Types.ObjectId|null} [opts.cronRunId]
 * @param {string|null} [opts.cronJobKey]
 * @param {boolean} [opts.requireRegistered]
 * @returns {Promise<{ noop?: boolean, reason?: string, attempted?: number, succeeded?: number, failed?: number, attemptBatchId?: mongoose.Types.ObjectId }>}
 */
async function executeRetryAttempt(opts) {
  const {
    retryGroupId,
    nextAttempt,
    attemptBatchId: incomingBatchId,
    source,
    cronRunId = null,
    cronJobKey = null,
    requireRegistered = true
  } = opts;

  if (nextAttempt !== 2 && nextAttempt !== 3) {
    return { noop: true, reason: 'invalid_next_attempt' };
  }

  const gid = new mongoose.Types.ObjectId(String(retryGroupId));
  const fromAttempt = nextAttempt - 1;
  const group = await WhatsAppRetryGroup.findById(gid).lean();
  if (!group) return { noop: true, reason: 'group_not_found' };
  if (!isCampaignStrategy(group.messageKind)) {
    return { noop: true, reason: 'non_campaign_kind' };
  }
  const policy = getRetryPolicy(group.messageKind);
  if (nextAttempt > policy.maxAttempts) {
    return { noop: true, reason: 'max_attempts_policy_block' };
  }

  const attemptBatchId = incomingBatchId || new mongoose.Types.ObjectId();
  const batchField = nextAttempt === 2 ? 'attempt2BatchId' : 'attempt3BatchId';
  const timeField = nextAttempt === 2 ? 'attempt2TriggeredAt' : 'attempt3TriggeredAt';

  const existingBatch = group[batchField];
  if (existingBatch) {
    if (String(existingBatch) === String(attemptBatchId)) {
      return { noop: true, reason: 'idempotent_already_executed' };
    }
    return { noop: true, reason: 'duplicate_trigger' };
  }

  const preview = await computeRetryCandidates(gid, fromAttempt);
  if (!preview.candidateCount) {
    return { noop: true, reason: 'no_candidates' };
  }

  const sendFn = sendFnForKind(group.messageKind);
  if (!sendFn) {
    return { noop: true, reason: 'unknown_kind' };
  }

  const casFilter = {
    _id: gid,
    [batchField]: null
  };
  const casSet = {
    [batchField]: attemptBatchId,
    [timeField]: new Date(),
    updatedAt: new Date(),
    ...(nextAttempt === 3 && group.status === 'open' ? { status: 'exhausted' } : {})
  };

  const cas = await WhatsAppRetryGroup.updateOne(casFilter, { $set: casSet });
  if (!cas.modifiedCount) {
    const g2 = await WhatsAppRetryGroup.findById(gid).lean();
    if (g2 && String(g2[batchField]) === String(attemptBatchId)) {
      return { noop: true, reason: 'idempotent_race' };
    }
    return { noop: true, reason: 'duplicate_trigger_or_race' };
  }

  const { candidates: resolved } = await computeRetryCandidates(gid, fromAttempt);

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  if (!resolved.length) {
    return {
      noop: false,
      reason: 'zero_candidates_after_cas',
      attempted: 0,
      succeeded: 0,
      failed: 0,
      attemptBatchId
    };
  }

  /* eslint-disable no-await-in-loop */
  for (const c of resolved) {
    const subFull = await FormSubmission.findOne(
      requireRegistered ? { phone: c.phone, isRegistered: true } : { phone: c.phone }
    ).lean();

    if (!subFull) {
      failed += 1;
      continue;
    }

    attempted += 1;

    const withMeetingLink = group.messageKind === 'meet' || group.messageKind === '30min';
    const vars = buildSlotNotificationVariables(subFull, { withMeetingLink });

    const r = await safeSendWhatsApp({
      phone10: c.phone,
      formSubmissionId: subFull._id,
      vars,
      retryKind: group.messageKind,
      source,
      cronRunId,
      cronJobKey,
      sendFn,
      retryGroupId: gid,
      attemptNumber: nextAttempt,
      parentMessageEventId: c.parentMessageEventId,
      attemptBatchId,
      correlationId: null
    });
    if (r.success) succeeded += 1;
    else failed += 1;
  }
  /* eslint-enable no-await-in-loop */

  return { attempted, succeeded, failed, attemptBatchId };
}

/** @param {mongoose.Types.ObjectId|string} retryGroupId @param {2|3} promoteToAttempt */
async function previewRetryPromotion(retryGroupId, promoteToAttempt) {
  if (promoteToAttempt !== 2 && promoteToAttempt !== 3) {
    return {
      dupBlocked: false,
      candidateCount: 0,
      phonesSample: [],
      promoteToAttempt
    };
  }
  const fromAttempt = promoteToAttempt - 1;
  const group = await WhatsAppRetryGroup.findById(retryGroupId).lean();
  const batchKey = promoteToAttempt === 2 ? 'attempt2BatchId' : 'attempt3BatchId';
  const dupBlocked = !!(group && group[batchKey]);
  const { candidateCount, candidates } = await computeRetryCandidates(retryGroupId, fromAttempt);
  const phonesSample = candidates.slice(0, 12).map((c) => {
    const tail = String(c.phone || '').slice(-4);
    return tail.length === 4 ? `****${tail}` : '****';
  });
  return { dupBlocked, candidateCount, phonesSample, promoteToAttempt };
}

const DEFAULT_MAX_GROUPS_PER_CRON = parseInt(process.env.WHATSAPP_RETRY_CRON_MAX_GROUPS || '15', 10) || 15;

/**
 * Sweep open groups needing attempt 2 or 3 promotions (cron).
 * @returns {Promise<{ groupsTouched: number, attempted: number, succeeded: number, failed: number, foundCandidates: number }>}
 */
async function scanGroupsNeedingRetries(cronRunId) {
  const windowStart = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const groups = await WhatsAppRetryGroup.find({
    status: { $in: ['open'] },
    createdAt: { $gte: windowStart }
  })
    .sort({ createdAt: 1 })
    .limit(250)
    .lean();

  let groupsTouched = 0;
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let foundCandidates = 0;

  /* eslint-disable no-await-in-loop */
  for (const g of groups) {
    if (groupsTouched >= DEFAULT_MAX_GROUPS_PER_CRON) break;
    if (!isCampaignStrategy(g.messageKind)) continue;

    let promoteTo = null;
    if (!g.attempt2BatchId) {
      const p = await computeRetryCandidates(g._id, 1);
      if (p.candidateCount > 0) promoteTo = 2;
    } else if (!g.attempt3BatchId) {
      const p = await computeRetryCandidates(g._id, 2);
      if (p.candidateCount > 0) promoteTo = 3;
    }
    if (!promoteTo) continue;

    foundCandidates += 1;
    const batchId = new mongoose.Types.ObjectId();
    const ex = await executeRetryAttempt({
      retryGroupId: g._id,
      nextAttempt: promoteTo,
      attemptBatchId: batchId,
      source: 'retry_cron',
      cronRunId,
      cronJobKey: 'retry_whatsapp',
      requireRegistered: true
    });
    if (ex.noop) continue;
    groupsTouched += 1;
    attempted += ex.attempted || 0;
    succeeded += ex.succeeded || 0;
    failed += ex.failed || 0;
  }
  /* eslint-enable no-await-in-loop */

  return { groupsTouched, attempted, succeeded, failed, foundCandidates };
}

/**
 * Short-delay queued retry for slot_booked only (attempt2 max).
 * @returns {Promise<{ considered: number, attempted: number, succeeded: number, failed: number }>}
 */
async function processSlotBookedImmediateRetries(cronRunId) {
  const policy = getRetryPolicy('slot_booked');
  const delayMs = Math.min(60, Math.max(10, Number(policy.immediateRetryDelaySeconds) || 15)) * 1000;
  const lockMs = Math.max(
    30 * 1000,
    (parseInt(process.env.WA_SLOT_BOOKED_IMMEDIATE_LOCK_SECONDS || '180', 10) || 180) * 1000
  );
  const dueBefore = new Date(Date.now() - delayMs);

  const rows = await WhatsAppMessageEvent.find({
    messageKind: 'slot_booked',
    attemptNumber: 1,
    status: { $in: TERMINAL_FAILURE_STATUSES },
    retryEligible: true,
    createdAt: { $lte: dueBefore }
  })
    .select('_id phone retryGroupId formSubmissionId errorMessage webhookErrorCode webhookErrorReason')
    .sort({ createdAt: 1 })
    .limit(parseInt(process.env.WA_SLOT_BOOKED_IMMEDIATE_RETRY_MAX_ROWS || '200', 10) || 200)
    .lean();

  let considered = 0;
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  /* eslint-disable no-await-in-loop */
  for (const row of rows) {
    considered += 1;
    if (!row.retryGroupId) continue;
    const lockToken = new mongoose.Types.ObjectId().toString();
    const lockNow = new Date();
    const lockUntil = new Date(lockNow.getTime() + lockMs);
    const claimed = await WhatsAppMessageEvent.findOneAndUpdate(
      {
        _id: row._id,
        messageKind: 'slot_booked',
        attemptNumber: 1,
        retryEligible: true,
        status: { $in: TERMINAL_FAILURE_STATUSES },
        $or: [
          { immediateRetryLockUntil: null },
          { immediateRetryLockUntil: { $lt: lockNow } }
        ]
      },
      {
        $set: {
          immediateRetryLockToken: lockToken,
          immediateRetryLockedAt: lockNow,
          immediateRetryLockUntil: lockUntil,
          immediateRetryLastTriedAt: lockNow
        }
      },
      { new: true }
    ).lean();
    if (!claimed) continue;

    const alreadySecond = await WhatsAppMessageEvent.exists({
      retryGroupId: row.retryGroupId,
      phone: row.phone,
      attemptNumber: 2
    });
    if (alreadySecond) {
      await WhatsAppMessageEvent.updateOne(
        { _id: row._id, immediateRetryLockToken: lockToken },
        {
          $set: { retryEligible: false },
          $unset: { immediateRetryLockToken: '', immediateRetryLockedAt: '', immediateRetryLockUntil: '' }
        }
      );
      continue;
    }

    const group = await WhatsAppRetryGroup.findById(row.retryGroupId).lean();
    if (!group || group.messageKind !== 'slot_booked') {
      await WhatsAppMessageEvent.updateOne(
        { _id: row._id, immediateRetryLockToken: lockToken },
        { $unset: { immediateRetryLockToken: '', immediateRetryLockedAt: '', immediateRetryLockUntil: '' } }
      );
      continue;
    }
    if (!isRetryableFailure('slot_booked', {
      errorCode: row.webhookErrorCode,
      errorReason: row.webhookErrorReason,
      errorText: row.errorMessage
    })) {
      await WhatsAppMessageEvent.updateOne(
        { _id: row._id, immediateRetryLockToken: lockToken },
        {
          $set: { retryEligible: false, status: 'retry_exhausted' },
          $unset: { immediateRetryLockToken: '', immediateRetryLockedAt: '', immediateRetryLockUntil: '' }
        }
      );
      continue;
    }

    const sub = await FormSubmission.findOne({ phone: row.phone, isRegistered: true }).lean();
    if (!sub) {
      failed += 1;
      await WhatsAppMessageEvent.updateOne(
        { _id: row._id, immediateRetryLockToken: lockToken },
        {
          $set: { retryEligible: false },
          $unset: { immediateRetryLockToken: '', immediateRetryLockedAt: '', immediateRetryLockUntil: '' }
        }
      );
      continue;
    }
    const reserveResult = await WhatsAppMessageEvent.updateOne(
      { retryGroupId: row.retryGroupId, phone: row.phone, attemptNumber: 2 },
      {
        $setOnInsert: {
          retryGroupId: row.retryGroupId,
          attemptNumber: 2,
          phone: row.phone,
          formSubmissionId: sub._id || row.formSubmissionId || null,
          messageKind: 'slot_booked',
          source: 'retry_cron',
          retrySource: 'retry1',
          parentMessageEventId: row._id,
          status: 'retry_pending',
          retryEligible: false,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    if (!(reserveResult.upsertedCount > 0)) {
      await WhatsAppMessageEvent.updateOne(
        { _id: row._id, immediateRetryLockToken: lockToken },
        {
          $set: { retryEligible: false },
          $unset: { immediateRetryLockToken: '', immediateRetryLockedAt: '', immediateRetryLockUntil: '' }
        }
      );
      continue;
    }
    const vars = buildSlotNotificationVariables(sub);
    attempted += 1;
    const r = await safeSendWhatsApp({
      phone10: row.phone,
      formSubmissionId: sub._id || row.formSubmissionId || null,
      vars,
      retryKind: 'slot_booked',
      source: 'retry_cron',
      cronRunId,
      cronJobKey: 'slot_booked_immediate_retry',
      sendFn: sendSlotBookedWhatsApp,
      retryGroupId: row.retryGroupId,
      attemptNumber: 2,
      parentMessageEventId: row._id,
      attemptBatchId: null,
      correlationId: null
    });
    await WhatsAppMessageEvent.updateOne(
      { _id: row._id, immediateRetryLockToken: lockToken },
      {
        $set: { retryEligible: false },
        $unset: { immediateRetryLockToken: '', immediateRetryLockedAt: '', immediateRetryLockUntil: '' }
      }
    );
    if (r.success) succeeded += 1;
    else failed += 1;
  }
  /* eslint-enable no-await-in-loop */

  return { considered, attempted, succeeded, failed };
}

module.exports = {
  computeRetryCandidates,
  executeRetryAttempt,
  previewRetryPromotion,
  scanGroupsNeedingRetries,
  cooldownMs,
  processSlotBookedImmediateRetries
};
