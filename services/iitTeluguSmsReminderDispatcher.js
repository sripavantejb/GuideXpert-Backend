/**
 * Claim and execute due IitTeluguSmsReminderJob rows (MSG91 Flow only).
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');
const { IIT_TELUGU_SMS_MESSAGE_KINDS } = require('../models/IitTeluguSmsReminderJob');
const { sendIitTeluguFlowSms } = require('../utils/msg91Service');
const { isPostSlotKind } = require('../utils/iitTeluguSmsSchedule');
const { buildFlowVariablesForKind } = require('../config/iitTeluguSmsTemplates');
const {
  buildClaimedBy,
  clearLeaseFields,
  clearLeaseUpdate,
  expireDueTeluguSmsJobs,
  recoverStuckTeluguSmsJobs,
} = require('./iitTeluguSmsJobLifecycle');

function claimTtlMs() {
  return Math.max(30000, parseInt(process.env.IIT_TELUGU_SMS_CLAIM_TTL_MS || '120000', 10) || 120000);
}

function batchLimit() {
  return Math.min(
    500,
    Math.max(10, parseInt(process.env.IIT_TELUGU_SMS_BATCH_LIMIT || '200', 10) || 200)
  );
}

function maxDispatchPerRun() {
  const batch = batchLimit();
  const v = parseInt(process.env.IIT_TELUGU_SMS_MAX_DISPATCH_PER_RUN || String(batch), 10);
  return Math.min(batch, Number.isFinite(v) && v > 0 ? v : batch);
}

function maxAttempts() {
  return Math.max(1, parseInt(process.env.IIT_TELUGU_SMS_MAX_ATTEMPTS || '3', 10) || 3);
}

function interSendDelayMs() {
  return Math.max(0, parseInt(process.env.IIT_TELUGU_SMS_INTER_SEND_DELAY_MS || '0', 10) || 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kindFilter(kinds) {
  return kinds.length ? { $in: kinds } : { $in: [...IIT_TELUGU_SMS_MESSAGE_KINDS] };
}

function submissionIdMatchFragment(submissionIdFilter) {
  if (!submissionIdFilter) return {};
  if (mongoose.Types.ObjectId.isValid(String(submissionIdFilter))) {
    return { iitCounsellingSubmissionId: submissionIdFilter };
  }
  return { ...submissionIdFilter };
}

function leaseFreeCondition(now) {
  return {
    $or: [
      { leaseExpiresAt: null },
      { leaseExpiresAt: { $exists: false } },
      { leaseExpiresAt: { $lt: now } },
      { claimedUntil: null },
      { claimedUntil: { $exists: false } },
      { claimedUntil: { $lt: now } },
    ],
  };
}

function expiredLeaseCondition(now) {
  return {
    $or: [{ leaseExpiresAt: { $lt: now } }, { claimedUntil: { $lt: now } }],
  };
}

function buildClaimableFilter(now, kinds, submissionIdFilter) {
  const base = {
    messageKind: kindFilter(kinds),
    ...submissionIdMatchFragment(submissionIdFilter),
  };

  return {
    $or: [
      {
        ...base,
        state: { $in: ['claimed', 'dispatching'] },
        ...expiredLeaseCondition(now),
      },
      {
        $and: [
          base,
          { state: 'pending' },
          { scheduledSendAt: { $lte: now } },
          leaseFreeCondition(now),
        ],
      },
    ],
  };
}

async function claimOneTeluguSmsJob(opts) {
  const now = opts.now || new Date();
  const until = new Date(now.getTime() + claimTtlMs());
  const token = crypto.randomBytes(12).toString('hex');
  const claimedBy = buildClaimedBy(opts.cronRunId);

  const filter = buildClaimableFilter(
    now,
    opts.messageKinds || [],
    opts.submissionIdFilter
  );

  const doc = await IitTeluguSmsReminderJob.findOneAndUpdate(
    filter,
    {
      $set: {
        state: 'claimed',
        claimedAt: now,
        claimedBy,
        claimToken: token,
        claimedUntil: until,
        leaseExpiresAt: until,
        cronRunId: opts.cronRunId || null,
      },
    },
    { sort: { scheduledSendAt: 1 }, new: true }
  ).lean();

  return doc;
}

async function releaseJobClaim(jobId, claimToken) {
  if (!jobId || !claimToken) return { modified: 0 };
  return IitTeluguSmsReminderJob.updateOne(
    {
      _id: jobId,
      claimToken,
      state: { $in: ['claimed', 'dispatching'] },
    },
    { $set: { state: 'pending', updatedAt: new Date(), ...clearLeaseFields() } }
  );
}

async function transitionToDispatching(jobId, claimToken, now = new Date()) {
  const res = await IitTeluguSmsReminderJob.updateOne(
    { _id: jobId, claimToken, state: 'claimed' },
    { $set: { state: 'dispatching', updatedAt: now } }
  );
  return res.modifiedCount > 0;
}

function isInfrastructureError(errorText) {
  const t = String(errorText || '').toLowerCase();
  return (
    t.includes('not configured') ||
    t.includes('econnrefused') ||
    t.includes('timeout') ||
    t.includes('network')
  );
}

/**
 * @param {object} job lean with claimToken
 */
async function executeIitTeluguSmsJob(job, cronRunId, cronJobKey, execOpts = {}) {
  const now = execOpts.now instanceof Date ? execOpts.now : new Date();
  const fresh = await IitTeluguSmsReminderJob.findById(job._id).lean();
  if (!fresh || fresh.claimToken !== job.claimToken) {
    return { outcome: 'deferred', reason: 'claim_token_mismatch' };
  }

  if (fresh.state === 'skipped' || fresh.state === 'cancelled' || fresh.state === 'dispatched') {
    await releaseJobClaim(job._id, job.claimToken);
    return { outcome: 'skipped', reason: fresh.suppressionReason || fresh.state };
  }

  const iitSub = await IitCounsellingSubmission.findById(job.iitCounsellingSubmissionId).lean();
  if (!iitSub) {
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'missing_iit_submission',
          completedAt: now,
          lastError: 'iit_submission_not_found',
          ...clearLeaseUpdate(),
        },
      }
    );
    return { outcome: 'skipped', reason: 'missing_iit_submission' };
  }

  const lang = iitSub.iitCounselling?.section2Data?.preferredLanguage;
  if (lang !== 'Telugu') {
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'language_not_telugu',
          completedAt: now,
          ...clearLeaseUpdate(),
        },
      }
    );
    return { outcome: 'skipped', reason: 'language_not_telugu' };
  }

  const slotDate = iitSub.counsellingSlotInstantUtc;
  const slotMs = slotDate ? new Date(slotDate).getTime() : NaN;
  const nowMs = now.getTime();

  const pastExpiry = job.expiresAt && new Date(job.expiresAt).getTime() <= nowMs;
  const allowImmediateTminus2h =
    job.sendImmediately &&
    job.messageKind === 'iit_sms_tminus_2h' &&
    !Number.isNaN(slotMs) &&
    nowMs < slotMs;

  if (pastExpiry && !allowImmediateTminus2h) {
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'expired',
          completedAt: now,
          expiredAt: now,
          ...clearLeaseUpdate(),
        },
      }
    );
    return { outcome: 'skipped', reason: 'expired' };
  }

  if (!isPostSlotKind(job.messageKind) && !Number.isNaN(slotMs) && nowMs >= slotMs) {
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'slot_passed',
          completedAt: now,
          ...clearLeaseUpdate(),
        },
      }
    );
    return { outcome: 'skipped', reason: 'slot_passed' };
  }

  if (job.scheduledSendAt && new Date(job.scheduledSendAt).getTime() > nowMs) {
    await releaseJobClaim(job._id, job.claimToken);
    return { outcome: 'deferred', reason: 'before_scheduled_time' };
  }

  const templateId = job.msg91TemplateId;
  if (!templateId || templateId === 'missing') {
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'skipped',
          suppressionReason: 'template_id_missing',
          completedAt: now,
          ...clearLeaseUpdate(),
        },
      }
    );
    return { outcome: 'skipped', reason: 'template_id_missing' };
  }

  const dispatchingOk = await transitionToDispatching(job._id, job.claimToken, now);
  if (!dispatchingOk) {
    return { outcome: 'deferred', reason: 'dispatching_transition_failed' };
  }

  const variables =
    job.templateVariables && typeof job.templateVariables === 'object'
      ? job.templateVariables
      : buildFlowVariablesForKind(job.messageKind);

  const sms = await sendIitTeluguFlowSms(job.phone, templateId, variables);
  const attempts = (job.attempts || 0) + 1;

  if (!sms.success && isInfrastructureError(sms.error) && attempts < maxAttempts()) {
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: 'pending',
          attempts,
          lastError: sms.error || 'infrastructure_error',
          updatedAt: now,
          ...clearLeaseFields(),
        },
      }
    );
    return { outcome: 'deferred', reason: 'infrastructure_error' };
  }

  if (!sms.success) {
    const terminal = attempts >= maxAttempts();
    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id, claimToken: job.claimToken },
      {
        $set: {
          state: terminal ? 'exhausted' : 'failed',
          attempts,
          lastError: sms.error || 'send_failed',
          completedAt: terminal ? now : null,
          providerResponse: sms.response || null,
          templateVariables: variables,
          executionMetadata: {
            lastDispatch: { at: now, source: cronJobKey, success: false },
          },
          ...clearLeaseUpdate(),
        },
      }
    );
    return { outcome: terminal ? 'exhausted' : 'failed', error: sms.error };
  }

  await IitTeluguSmsReminderJob.updateOne(
    { _id: job._id, claimToken: job.claimToken },
    {
      $set: {
        state: 'dispatched',
        attempts,
        dispatchedAt: now,
        completedAt: now,
        providerResponse: sms.response || null,
        templateVariables: variables,
        lastError: null,
        cronRunId: cronRunId || null,
        executionMetadata: {
          lastDispatch: { at: now, source: cronJobKey, success: true },
        },
        ...clearLeaseUpdate(),
      },
    }
  );

  return { outcome: 'dispatched' };
}

async function claimDueTeluguSmsJobs(opts) {
  const limit = opts.limit != null ? opts.limit : maxDispatchPerRun();
  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await claimOneTeluguSmsJob(opts);
    if (!doc) break;
    claimed.push(doc);
  }
  return claimed;
}

/**
 * @param {{ messageKinds?: string[], now?: Date, cronRunId?: object, cronJobKey?: string, limit?: number, submissionIdFilter?: object, skipRecovery?: boolean, includeImmediate?: boolean }} opts
 */
async function dispatchDueIitTeluguSmsJobs(opts = {}) {
  const now = opts.now || new Date();
  const kinds = Array.isArray(opts.messageKinds) ? opts.messageKinds : [...IIT_TELUGU_SMS_MESSAGE_KINDS];
  const delayMs = interSendDelayMs();
  const cronJobKey = opts.cronJobKey || 'send_iit_telugu_sms';

  let jobsExpired = 0;
  if (!opts.skipRecovery) {
    await recoverStuckTeluguSmsJobs({ now, messageKinds: kinds, limit: 100 });
    const expireRes = await expireDueTeluguSmsJobs({ now, messageKinds: kinds, limit: 2000 });
    jobsExpired = expireRes.expired || 0;
  }

  const claimed = await claimDueTeluguSmsJobs({
    ...opts,
    now,
    messageKinds: kinds,
    limit: opts.limit != null ? opts.limit : maxDispatchPerRun(),
  });

  const stats = {
    jobsExpired,
    jobsClaimed: claimed.length,
    jobsDispatched: 0,
    jobsSkipped: 0,
    jobsFailed: 0,
    jobsDeferred: 0,
    outcomes: [],
  };

  for (const job of claimed) {
    // eslint-disable-next-line no-await-in-loop
    const result = await executeIitTeluguSmsJob(job, opts.cronRunId, cronJobKey, { now });
    stats.outcomes.push({ jobId: String(job._id), messageKind: job.messageKind, ...result });
    if (result.outcome === 'dispatched') stats.jobsDispatched += 1;
    else if (result.outcome === 'skipped') stats.jobsSkipped += 1;
    else if (result.outcome === 'failed' || result.outcome === 'exhausted') stats.jobsFailed += 1;
    else stats.jobsDeferred += 1;
    if (delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  return stats;
}

module.exports = {
  dispatchDueIitTeluguSmsJobs,
  executeIitTeluguSmsJob,
  claimDueTeluguSmsJobs,
};
