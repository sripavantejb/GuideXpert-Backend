/**
 * P3: Claim and execute due WhatsAppReminderJob rows (hardened CAS + fair queue).
 */
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const {
  sendBulkReminderSms,
  sendBulkMeetLinkSms,
  sendBulkReminder30MinSms
} = require('../utils/msg91Service');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');
const {
  sendPre4HrReminderWhatsApp,
  sendMeetLinkWhatsApp,
  sendReminder30MinWhatsApp
} = require('../services/gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const { markCampaignSentFlag } = require('../utils/waCampaignSentFlags');
const { getCampaignReminderEligibility } = require('../utils/waReminderEligibility');
const {
  syncReminderJobFromRetryGroup,
  buildClaimedBy,
  clearLeaseFields,
  recoverStuckReminderJobs,
  repairReminderJobLifecycle,
  expireDueReminderJobs
} = require('./whatsappReminderJobLifecycle');
const { overdueSlaMs } = require('../utils/waReminderJobObservability');
const {
  computeFairClaimLimits,
  isOverdueForFairness,
  isCatchUpModeActive
} = require('../utils/waReminderJobDispatchQueue');

function claimTtlMs() {
  return Math.max(30000, parseInt(process.env.WA_REMINDER_JOB_CLAIM_TTL_MS || '120000', 10) || 120000);
}

function batchLimit() {
  return Math.min(
    2000,
    Math.max(10, parseInt(process.env.WA_REMINDER_JOB_BATCH_LIMIT || '500', 10) || 500)
  );
}

function maxDispatchPerRun() {
  const batch = batchLimit();
  const v = parseInt(process.env.WA_REMINDER_JOB_MAX_DISPATCH_PER_RUN || String(batch), 10);
  return Math.min(batch, Number.isFinite(v) && v > 0 ? v : batch);
}

function interSendDelayMs() {
  return Math.max(0, parseInt(process.env.WA_REMINDER_JOB_INTER_SEND_DELAY_MS || '0', 10) || 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cronJobKeyForKind(kind) {
  if (kind === 'pre4hr') return 'send_reminders';
  if (kind === 'meet') return 'send_meetlinks';
  if (kind === '30min') return 'send_30min_reminders';
  return 'send_reminders';
}

function sendFnForKind(kind) {
  if (kind === 'pre4hr') {
    return (phone10, vars, sendOpts) => sendPre4HrReminderWhatsApp(phone10, vars, sendOpts || {});
  }
  if (kind === 'meet') {
    return (phone10, vars, sendOpts) => sendMeetLinkWhatsApp(phone10, vars, sendOpts || {});
  }
  if (kind === '30min') {
    return (phone10, vars, sendOpts) => sendReminder30MinWhatsApp(phone10, vars, sendOpts || {});
  }
  return null;
}

async function sendSmsForKind(kind, phone, submission) {
  const meetingLink = process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo';
  if (kind === 'pre4hr') {
    return sendBulkReminderSms([phone], buildSlotNotificationVariables(submission));
  }
  if (kind === 'meet') {
    return sendBulkMeetLinkSms([phone], { var: meetingLink });
  }
  if (kind === '30min') {
    return sendBulkReminder30MinSms([phone], { var: meetingLink });
  }
  return { success: true, sentCount: 0 };
}

function kindFilter(kinds) {
  return kinds.length ? { $in: kinds } : { $in: ['pre4hr', 'meet', '30min'] };
}

function leaseFreeCondition(now) {
  return {
    $or: [
      { leaseExpiresAt: null },
      { leaseExpiresAt: { $exists: false } },
      { leaseExpiresAt: { $lt: now } },
      { claimedUntil: null },
      { claimedUntil: { $exists: false } },
      { claimedUntil: { $lt: now } }
    ]
  };
}

function expiredLeaseCondition(now) {
  return {
    $or: [{ leaseExpiresAt: { $lt: now } }, { claimedUntil: { $lt: now } }]
  };
}

function buildClaimableFilter(now, kinds, submissionIdFilter, bucket) {
  const base = {
    messageKind: kindFilter(kinds),
    ...(submissionIdFilter ? { formSubmissionId: submissionIdFilter } : {})
  };

  const overdueBefore = new Date(now.getTime() - overdueSlaMs());
  const stuck = {
    ...base,
    state: { $in: ['claimed', 'dispatching'] },
    ...expiredLeaseCondition(now)
  };

  if (bucket === 'overdue') {
    return {
      $or: [
        stuck,
        {
          $and: [
            base,
            { state: 'pending' },
            { scheduledSendAt: { $lte: overdueBefore } },
            leaseFreeCondition(now)
          ]
        }
      ]
    };
  }

  return {
    $or: [
      stuck,
      {
        $and: [
          base,
          { state: 'pending' },
          { scheduledSendAt: { $gt: overdueBefore, $lte: now } },
          leaseFreeCondition(now)
        ]
      }
    ]
  };
}

/**
 * @param {object} opts
 * @param {'overdue'|'fresh'} opts.bucket
 */
async function claimOneJob(opts) {
  const now = opts.now || new Date();
  const until = new Date(now.getTime() + claimTtlMs());
  const token =
    opts.cronRunId && mongoose.Types.ObjectId.isValid(String(opts.cronRunId))
      ? String(opts.cronRunId)
      : `cron-${Date.now()}`;
  const claimedBy = buildClaimedBy(opts.cronRunId);

  const filter = buildClaimableFilter(
    now,
    opts.messageKinds || [],
    opts.submissionIdFilter,
    opts.bucket
  );

  const doc = await WhatsAppReminderJob.findOneAndUpdate(
    filter,
    {
      $set: {
        state: 'claimed',
        claimedAt: now,
        claimedBy,
        claimToken: token,
        claimedUntil: until,
        leaseExpiresAt: until,
        cronRunId: opts.cronRunId || null
      }
    },
    { sort: { scheduledSendAt: 1 }, new: true }
  ).lean();

  return doc;
}

async function releaseJobClaim(jobId, claimToken) {
  if (!jobId || !claimToken) return { modified: 0 };
  const res = await WhatsAppReminderJob.updateOne(
    {
      _id: jobId,
      claimToken,
      state: { $in: ['claimed', 'dispatching'] }
    },
    { $set: { state: 'pending', updatedAt: new Date(), ...clearLeaseFields() } }
  );
  return res;
}

async function transitionToDispatching(jobId, claimToken) {
  const now = new Date();
  const res = await WhatsAppReminderJob.updateOne(
    { _id: jobId, claimToken, state: 'claimed' },
    { $set: { state: 'dispatching', updatedAt: now } }
  );
  return res.modifiedCount > 0;
}

function clearLeaseUpdate(extra = {}) {
  return { ...clearLeaseFields(), ...extra };
}

/**
 * @param {object} job lean doc (must include claimToken from claim)
 */
async function executeReminderJob(job, cronRunId, cronJobKey) {
  const now = new Date();
  const fresh = await WhatsAppReminderJob.findById(job._id).lean();
  if (!fresh || fresh.claimToken !== job.claimToken) {
    return { outcome: 'deferred', reason: 'claim_token_mismatch' };
  }

  const submission = await FormSubmission.findById(job.formSubmissionId).lean();
  if (!submission || !submission.isRegistered) {
    await WhatsAppReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'missing_registered_submission',
          completedAt: now,
          lastError: 'not_registered',
          ...clearLeaseUpdate()
        }
      }
    );
    return { outcome: 'skipped', reason: 'not_registered' };
  }

  const slotDate = submission.step3Data && submission.step3Data.slotDate;
  const elig = getCampaignReminderEligibility(job.messageKind, slotDate, now);
  if (elig.reason === 'before_eligibility') {
    await releaseJobClaim(job._id, job.claimToken);
    return { outcome: 'deferred', reason: 'before_eligibility' };
  }
  if (elig.reason === 'slot_passed' || now.getTime() >= new Date(slotDate).getTime()) {
    await WhatsAppReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'slot_passed',
          completedAt: now,
          ...clearLeaseUpdate()
        }
      }
    );
    return { outcome: 'skipped', reason: 'slot_passed' };
  }

  const waVars =
    job.messageKind === 'meet' || job.messageKind === '30min'
      ? buildSlotNotificationVariables(submission, { withMeetingLink: true })
      : buildSlotNotificationVariables(submission);

  const sendFn = sendFnForKind(job.messageKind);
  if (!sendFn) {
    await releaseJobClaim(job._id, job.claimToken);
    return { outcome: 'error', reason: 'unknown_kind' };
  }

  const dispatchingOk = await transitionToDispatching(job._id, job.claimToken);
  if (!dispatchingOk) {
    return { outcome: 'deferred', reason: 'dispatching_transition_failed' };
  }

  await sendSmsForKind(job.messageKind, job.phone, submission).catch(() => {});

  const wa = await safeSendWhatsApp({
    phone10: job.phone,
    formSubmissionId: job.formSubmissionId,
    vars: waVars,
    retryKind: job.messageKind,
    source: 'cron',
    cronRunId: cronRunId || null,
    cronJobKey: cronJobKey || cronJobKeyForKind(job.messageKind),
    sendFn,
    retryGroupId: job.retryGroupId,
    attemptNumber: 1,
    attemptBatchId: cronRunId || null
  });

  const attempts = (job.attempts || 0) + 1;

  if (wa.duplicateInFlight) {
    await releaseJobClaim(job._id, job.claimToken);
    return { outcome: 'deferred', reason: 'duplicate_in_flight' };
  }

  if (wa.skippedOutsideWindow || wa.blockedPreSend) {
    if (elig.reason === 'before_eligibility' || (elig.earliestAt && now < elig.earliestAt)) {
      await releaseJobClaim(job._id, job.claimToken);
      return { outcome: 'deferred', reason: wa.error || 'outside_window' };
    }
    await WhatsAppReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: wa.error || 'outside_window',
          attempts,
          lastError: wa.error || null,
          completedAt: now,
          ...clearLeaseUpdate()
        }
      }
    );
    return { outcome: 'skipped', reason: wa.error };
  }

  let initialMessageEventId = null;
  let providerMessageId = null;
  if (job.retryGroupId) {
    const ev = await WhatsAppMessageEvent.findOne({
      retryGroupId: job.retryGroupId,
      attemptNumber: 1
    })
      .select('_id gupshupMessageId messageId')
      .lean();
    if (ev) {
      initialMessageEventId = ev._id;
      providerMessageId = ev.gupshupMessageId || ev.messageId || null;
    }
  }

  const dispatchFields = {
    state: 'dispatched',
    attempts,
    dispatchedAt: now,
    initialMessageEventId,
    latestMessageEventId: initialMessageEventId,
    rootMessageEventId: initialMessageEventId,
    providerMessageId,
    cronRunId: cronRunId || null,
    'executionMetadata.lastDispatch': { at: now, source: cronJobKey },
    ...clearLeaseUpdate({ lastError: wa.success ? null : wa.error || 'send_failed' })
  };

  if (wa.success) {
    await markCampaignSentFlag(FormSubmission, job.phone, job.messageKind);
    await WhatsAppReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      { $set: dispatchFields }
    );
    if (job.retryGroupId) {
      await syncReminderJobFromRetryGroup(job.retryGroupId).catch(() => {});
    }
    return { outcome: 'dispatched' };
  }

  await WhatsAppReminderJob.updateOne(
    { _id: job._id, claimToken: job.claimToken },
    { $set: dispatchFields }
  );
  if (job.retryGroupId) {
    await syncReminderJobFromRetryGroup(job.retryGroupId).catch(() => {});
  }
  return { outcome: 'failed', error: wa.error };
}

async function countBacklogBuckets(now, kinds, submissionIdFilter) {
  const base = {
    state: 'pending',
    scheduledSendAt: { $lte: now },
    messageKind: kindFilter(kinds),
    ...(submissionIdFilter ? { formSubmissionId: submissionIdFilter } : {})
  };
  const overdueBefore = new Date(now.getTime() - overdueSlaMs());
  const [overdueCount, freshDueCount, oldest] = await Promise.all([
    WhatsAppReminderJob.countDocuments({
      ...base,
      scheduledSendAt: { $lte: overdueBefore }
    }),
    WhatsAppReminderJob.countDocuments({
      ...base,
      scheduledSendAt: { $gt: overdueBefore }
    }),
    WhatsAppReminderJob.findOne({ ...base, scheduledSendAt: { $lte: overdueBefore } })
      .sort({ scheduledSendAt: 1 })
      .select('scheduledSendAt')
      .lean()
  ]);
  const oldestOverdueMs =
    oldest && oldest.scheduledSendAt
      ? now.getTime() - new Date(oldest.scheduledSendAt).getTime()
      : null;
  return { overdueCount, freshDueCount, oldestOverdueMs };
}

/**
 * @param {{ messageKinds: string[], now?: Date, cronRunId?: object, cronJobKey?: string, limit?: number, submissionIdFilter?: object, bucket?: string }} opts
 */
async function claimDueReminderJobs(opts) {
  const now = opts.now || new Date();
  const limit = opts.limit != null ? opts.limit : maxDispatchPerRun();
  const { overdueLimit, freshLimit } = computeFairClaimLimits(limit);
  const claimed = [];

  for (let i = 0; i < overdueLimit; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await claimOneJob({ ...opts, now, bucket: 'overdue' });
    if (!doc) break;
    claimed.push(doc);
  }

  for (let i = 0; i < freshLimit; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await claimOneJob({ ...opts, now, bucket: 'fresh' });
    if (!doc) break;
    claimed.push(doc);
  }

  return claimed;
}

/**
 * @param {{ messageKinds: string[], now?: Date, cronRunId?: object, cronJobKey?: string, limit?: number, submissionIdFilter?: object, skipRecovery?: boolean }} opts
 */
async function dispatchDueReminderJobs(opts) {
  const now = opts.now || new Date();
  const kinds = Array.isArray(opts.messageKinds) ? opts.messageKinds : [];
  const limit = opts.limit != null ? opts.limit : maxDispatchPerRun();
  const delayMs = interSendDelayMs();

  let jobsExpired = 0;
  if (!opts.skipRecovery) {
    await recoverStuckReminderJobs({ now, messageKinds: kinds, limit: 100 });
    const expireRes = await expireDueReminderJobs({ now, messageKinds: kinds, limit: 2000 });
    jobsExpired = expireRes.expired || 0;
  }

  const backlog = await countBacklogBuckets(now, kinds, opts.submissionIdFilter);
  const catchUpMode = isCatchUpModeActive(backlog);
  const { overdueLimit, freshLimit, ratio } = computeFairClaimLimits(limit);

  const claimed = await claimDueReminderJobs({ ...opts, now, limit });
  const stats = {
    jobsClaimed: claimed.length,
    jobsDispatched: 0,
    jobsFailed: 0,
    jobsSkipped: 0,
    jobsDeferred: 0,
    jobsExpired,
    backlogDepth: backlog.overdueCount + backlog.freshDueCount,
    overdueBacklog: backlog.overdueCount,
    freshDueBacklog: backlog.freshDueCount,
    oldestOverdueMs: backlog.oldestOverdueMs,
    catchUpMode,
    fairSplit: { overdueLimit, freshLimit, ratio },
    dispatchThroughput: 0
  };

  for (const job of claimed) {
    // eslint-disable-next-line no-await-in-loop
    const r = await executeReminderJob(job, opts.cronRunId, opts.cronJobKey);
    stats.dispatchThroughput += 1;
    if (r.outcome === 'dispatched') stats.jobsDispatched += 1;
    else if (r.outcome === 'failed') stats.jobsFailed += 1;
    else if (r.outcome === 'skipped') stats.jobsSkipped += 1;
    else if (r.outcome === 'deferred') stats.jobsDeferred += 1;
    if (delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  if (!opts.skipRecovery) {
    const repair = await repairReminderJobLifecycle({ now, messageKinds: kinds, limit: 50 });
    stats.repair = repair;
  }

  return stats;
}

module.exports = {
  claimDueReminderJobs,
  claimOneJob,
  executeReminderJob,
  dispatchDueReminderJobs,
  releaseJobClaim,
  cronJobKeyForKind,
  buildClaimableFilter,
  isOverdueForFairness,
  countBacklogBuckets,
  maxDispatchPerRun,
  interSendDelayMs
};
