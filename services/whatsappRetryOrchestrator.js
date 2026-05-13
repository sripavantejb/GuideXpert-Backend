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
  IN_FLIGHT_PROMOTION_STATUSES,
  RETRY_EXCLUSION_REASON,
  filterRetryPromotionRowsV2,
  isCampaignStrategy,
  getRetryPolicy,
  getRetryDelayMsAfterAttempt,
  inFlightPromotionStaleMsForKind,
  isRetryableFailure
} = require('../utils/whatsappRetryRules');
const { getCampaignReminderEligibility } = require('../utils/waReminderEligibility');

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

function mapReasonCounts(rows = []) {
  return rows.reduce((acc, row) => {
    if (!row || !row.reason) return acc;
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});
}

async function persistRetryExclusionStates({ includedRows, excludedRows, nextAttempt, attemptBatchId = null }) {
  const now = new Date();
  const includedIds = includedRows
    .map((r) => r && r._id)
    .filter((x) => x && mongoose.Types.ObjectId.isValid(String(x)))
    .map((x) => new mongoose.Types.ObjectId(String(x)));
  const excludedByReason = excludedRows.reduce((acc, row) => {
    if (!row || !row.parentMessageEventId || !row.reason) return acc;
    const id = String(row.parentMessageEventId);
    if (!mongoose.Types.ObjectId.isValid(id)) return acc;
    if (!acc[row.reason]) acc[row.reason] = [];
    acc[row.reason].push(new mongoose.Types.ObjectId(id));
    return acc;
  }, {});

  const ops = [];
  if (includedIds.length) {
    ops.push({
      updateMany: {
        filter: { _id: { $in: includedIds } },
        update: {
          $set: {
            retryExclusionReason: null,
            retryExclusionAt: null,
            'retryExclusionMeta.nextAttempt': null,
            'retryExclusionMeta.attemptBatchId': null,
            'retryExclusionMeta.note': null
          }
        }
      }
    });
  }
  Object.entries(excludedByReason).forEach(([reason, ids]) => {
    if (!ids.length) return;
    ops.push({
      updateMany: {
        filter: { _id: { $in: ids } },
        update: {
          $set: {
            retryExclusionReason: reason,
            retryExclusionAt: now,
            'retryExclusionMeta.nextAttempt': nextAttempt,
            'retryExclusionMeta.attemptBatchId': attemptBatchId || null,
            'retryExclusionMeta.note': 'candidate_filter'
          }
        }
      }
    });
  });
  if (ops.length > 0) {
    await WhatsAppMessageEvent.bulkWrite(ops, { ordered: false });
  }
}

/**
 * @param {mongoose.Types.ObjectId|string} retryGroupId
 * @param {1|2} fromAttempt failures at this slice feed the next promotion
 * @returns {Promise<{ candidateCount: number, candidates: { phone: string, parentMessageEventId: mongoose.Types.ObjectId }[], excludedReasons?: object, excludedRows?: object[] }>}
 */
function rowEligibleAtMs(groupKind, fromAttempt, row) {
  const delayMs = getRetryDelayMsAfterAttempt(groupKind, fromAttempt);
  const staleMs = inFlightPromotionStaleMsForKind(groupKind);
  const st = String(row.status || '').toLowerCase();
  const isTerminal = TERMINAL_FAILURE_STATUSES.includes(st);
  if (isTerminal) {
    const base = new Date(row.failedAt || row.updatedAt || row.createdAt || Date.now()).getTime();
    return base + delayMs;
  }
  if (IN_FLIGHT_PROMOTION_STATUSES.includes(st)) {
    const base = new Date(row.createdAt || Date.now()).getTime() + staleMs;
    return base + delayMs;
  }
  return Date.now();
}

async function computeRetryCandidates(retryGroupId, fromAttempt) {
  const gid = new mongoose.Types.ObjectId(String(retryGroupId));
  const fa = fromAttempt === 2 ? 2 : 1;
  const nextAttempt = fa + 1;
  const group = await WhatsAppRetryGroup.findById(gid).select('messageKind').lean();
  if (!group || !isCampaignStrategy(group.messageKind)) {
    return { candidateCount: 0, candidates: [], excludedReasons: { nonCampaignOrMissingGroup: true } };
  }

  const staleBefore = new Date(Date.now() - inFlightPromotionStaleMsForKind(group.messageKind));

  const [neverRetryPhones, alreadyNextPhones, rawRows] = await Promise.all([
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
      $or: [
        { status: { $in: TERMINAL_FAILURE_STATUSES } },
        { status: { $in: IN_FLIGHT_PROMOTION_STATUSES }, createdAt: { $lte: staleBefore } }
      ]
    })
      .select(
        'phone formSubmissionId failedAt updatedAt createdAt retryEligible _id status errorMessage webhookErrorCode webhookErrorReason'
      )
      .lean()
  ]);

  const permanentExcluded = [];
  const eligibleRows = [];
  const now = new Date();

  for (const r of rawRows || []) {
    const st = String(r.status || '').toLowerCase();
    if (TERMINAL_FAILURE_STATUSES.includes(st) && !isRetryableFailure(group.messageKind, {
      errorCode: r.webhookErrorCode,
      errorReason: r.webhookErrorReason,
      errorText: r.errorMessage
    })) {
      permanentExcluded.push({
        _id: r._id,
        phone: r.phone,
        reason: RETRY_EXCLUSION_REASON.permanentFailure
      });
      continue;
    }
    eligibleRows.push({
      ...r,
      eligibleAtMs: rowEligibleAtMs(group.messageKind, fromAttempt, r),
      _staleInFlight: IN_FLIGHT_PROMOTION_STATUSES.includes(st) && !TERMINAL_FAILURE_STATUSES.includes(st)
    });
  }

  if (permanentExcluded.length) {
    const permIds = permanentExcluded.map((x) => x._id).filter(Boolean);
    await WhatsAppMessageEvent.updateMany(
      { _id: { $in: permIds } },
      {
        $set: {
          retryEligible: false,
          terminalFailureKind: 'permanent',
          retryExclusionReason: RETRY_EXCLUSION_REASON.permanentFailure,
          retryExclusionAt: now,
          'retryExclusionMeta.nextAttempt': nextAttempt,
          'retryExclusionMeta.note': 'non_retryable_classification'
        }
      }
    );
  }

  const { includedRows, excludedRows, exclusionCounts } = filterRetryPromotionRowsV2(eligibleRows, {
    neverRetryPhones,
    alreadyPromotedPhones: alreadyNextPhones
  });

  const phonesForSlot = [...new Set(includedRows.map((r) => r.phone).filter(Boolean))];
  const subsByPhone = {};
  if (phonesForSlot.length) {
    const subs = await FormSubmission.find({ phone: { $in: phonesForSlot }, isRegistered: true })
      .select('phone step3Data.slotDate')
      .lean();
    subs.forEach((s) => {
      if (s && s.phone) subsByPhone[s.phone] = s;
    });
  }
  const slotOutsideExcluded = [];
  const includedAfterSlot = [];
  const nowSlot = new Date();
  includedRows.forEach((r) => {
    const sub = subsByPhone[r.phone];
    const slot = sub && sub.step3Data ? sub.step3Data.slotDate : null;
    const elig = getCampaignReminderEligibility(group.messageKind, slot, nowSlot);
    if (!elig.ok) {
      slotOutsideExcluded.push({
        phone: r.phone,
        parentMessageEventId: r._id,
        reason: RETRY_EXCLUSION_REASON.outsideReminderValidity
      });
    } else {
      includedAfterSlot.push(r);
    }
  });
  slotOutsideExcluded.forEach((row) => {
    exclusionCounts[row.reason] = (exclusionCounts[row.reason] || 0) + 1;
  });

  const permanentRows = permanentExcluded.map((x) => ({
    phone: x.phone,
    parentMessageEventId: x._id,
    reason: x.reason
  }));

  const allExcluded = [...permanentRows, ...slotOutsideExcluded, ...excludedRows];
  permanentRows.forEach((row) => {
    exclusionCounts[row.reason] = (exclusionCounts[row.reason] || 0) + 1;
  });

  const missingPhoneCount = rawRows.filter((r) => !r.phone).length;
  if (!exclusionCounts[RETRY_EXCLUSION_REASON.missingPhone] && missingPhoneCount > 0) {
    exclusionCounts[RETRY_EXCLUSION_REASON.missingPhone] = missingPhoneCount;
  }

  const candidates = includedAfterSlot.map((r) => ({
    phone: r.phone,
    parentMessageEventId: r._id,
    _staleInFlight: !!r._staleInFlight
  }));

  return {
    candidateCount: candidates.length,
    candidates,
    excludedRows: allExcluded,
    excludedReasons: {
      phonesDeliveredOrRead: neverRetryPhones.length,
      phonesAlreadyAtNextAttempt: alreadyNextPhones.length,
      rawRowsBeforeRules: rawRows.length,
      permanentClassified: permanentExcluded.length,
      outsideReminderValidity: slotOutsideExcluded.length,
      byReason: exclusionCounts,
      totalExcluded: allExcluded.length
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

  const wallMs = Math.max(60_000, parseInt(process.env.WHATSAPP_CAMPAIGN_RETRY_MAX_WALL_MS || '300000', 10) || 300000);
  const firstFailA1 = await WhatsAppMessageEvent.findOne({
    retryGroupId: gid,
    attemptNumber: 1,
    status: { $in: TERMINAL_FAILURE_STATUSES }
  })
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean();
  if (firstFailA1 && Date.now() - new Date(firstFailA1.createdAt).getTime() > wallMs) {
    await WhatsAppRetryGroup.updateOne(
      { _id: gid },
      { $set: { status: 'exhausted', nextPromotionDueAt: null, updatedAt: new Date() } }
    );
    return { noop: true, reason: 'retry_wall_clock_exceeded' };
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

  const { candidates: resolved, excludedRows = [], excludedReasons = {} } = await computeRetryCandidates(gid, fromAttempt);
  await persistRetryExclusionStates({
    includedRows: resolved.map((r) => ({ _id: r.parentMessageEventId })),
    excludedRows,
    nextAttempt,
    attemptBatchId
  });
  console.log('[RetryOrchestrator] reconciliation', {
    retryGroupId: String(gid),
    fromAttempt,
    nextAttempt,
    candidateCount: resolved.length,
    exclusionTotal: excludedRows.length,
    exclusionByReason: excludedReasons.byReason || {}
  });

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
      await WhatsAppMessageEvent.updateOne(
        { _id: c.parentMessageEventId },
        {
          $set: {
            retryEligible: false,
            retryExclusionReason: RETRY_EXCLUSION_REASON.missingRegisteredSubmission,
            retryExclusionAt: new Date(),
            'retryExclusionMeta.nextAttempt': nextAttempt,
            'retryExclusionMeta.attemptBatchId': attemptBatchId || null,
            'retryExclusionMeta.note': 'missing_registered_submission'
          }
        }
      );
      continue;
    }

    const slotDate = subFull.step3Data && subFull.step3Data.slotDate ? subFull.step3Data.slotDate : null;
    const elig = getCampaignReminderEligibility(group.messageKind, slotDate, new Date());
    if (!elig.ok) {
      failed += 1;
      await WhatsAppMessageEvent.updateOne(
        { _id: c.parentMessageEventId },
        {
          $set: {
            retryEligible: false,
            retryExclusionReason: RETRY_EXCLUSION_REASON.outsideReminderValidity,
            retryExclusionAt: new Date(),
            'retryExclusionMeta.nextAttempt': nextAttempt,
            'retryExclusionMeta.attemptBatchId': attemptBatchId || null,
            'retryExclusionMeta.note': elig.reason || 'outside_window'
          }
        }
      );
      continue;
    }

    attempted += 1;

    const withMeetingLink = group.messageKind === 'meet' || group.messageKind === '30min';
    const vars = buildSlotNotificationVariables(subFull, { withMeetingLink });

    if (c._staleInFlight) {
      await WhatsAppMessageEvent.updateOne(
        { _id: c.parentMessageEventId },
        {
          $set: {
            promotionSupersededAt: new Date(),
            retryEligible: false,
            retryExclusionReason: RETRY_EXCLUSION_REASON.inFlightTimeout,
            retryExclusionAt: new Date(),
            'retryExclusionMeta.nextAttempt': nextAttempt,
            'retryExclusionMeta.attemptBatchId': attemptBatchId || null,
            'retryExclusionMeta.note': 'stale_in_flight_promotion'
          }
        }
      );
    }

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

  const delayMs = getRetryDelayMsAfterAttempt(group.messageKind, fromAttempt);
  const completedField = fromAttempt === 1 ? 'attempt1CompletedAt' : 'attempt2CompletedAt';
  await WhatsAppRetryGroup.updateOne(
    { _id: gid },
    {
      $set: {
        [completedField]: new Date(),
        nextPromotionDueAt: new Date(Date.now() + delayMs),
        updatedAt: new Date()
      }
    }
  );

  return {
    attempted,
    succeeded,
    failed,
    attemptBatchId,
    exclusionSummary: {
      totalExcluded: excludedRows.length,
      byReason: mapReasonCounts(excludedRows)
    }
  };
}

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
  const { candidateCount, candidates, excludedReasons } = await computeRetryCandidates(retryGroupId, fromAttempt);
  const phonesSample = candidates.slice(0, 12).map((c) => {
    const tail = String(c.phone || '').slice(-4);
    return tail.length === 4 ? `****${tail}` : '****';
  });
  return { dupBlocked, candidateCount, phonesSample, excludedReasons, promoteToAttempt };
}

const CRON_BUDGET_MS = parseInt(process.env.WHATSAPP_RETRY_CRON_BUDGET_MS || '25000', 10) || 25000;

/**
 * Sweep open groups needing attempt 2 or 3 promotions (cron).
 * @returns {Promise<{ groupsTouched: number, attempted: number, succeeded: number, failed: number, foundCandidates: number, deferredByBudget: number }>}
 */
async function scanGroupsNeedingRetries(cronRunId) {
  const windowStart = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const groups = await WhatsAppRetryGroup.find({
    status: { $in: ['open'] },
    createdAt: { $gte: windowStart }
  })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();

  let groupsTouched = 0;
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let foundCandidates = 0;
  let deferredByBudget = 0;
  const deadline = Date.now() + CRON_BUDGET_MS;

  /* eslint-disable no-await-in-loop */
  for (const g of groups) {
    if (Date.now() > deadline) {
      deferredByBudget += 1;
      continue;
    }
    if (!isCampaignStrategy(g.messageKind)) continue;
    if (g.nextPromotionDueAt && new Date(g.nextPromotionDueAt).getTime() > Date.now()) continue;

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

  return { groupsTouched, attempted, succeeded, failed, foundCandidates, deferredByBudget };
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
