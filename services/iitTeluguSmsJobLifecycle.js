/**
 * Lease / expiry helpers for IitTeluguSmsReminderJob (parallel to WhatsApp reminder jobs).
 */
const os = require('os');
const mongoose = require('mongoose');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');

function buildClaimedBy(cronRunId) {
  const host = process.env.VERCEL_REGION || os.hostname() || 'worker';
  const run =
    cronRunId && mongoose.Types.ObjectId.isValid(String(cronRunId)) ? String(cronRunId) : 'cron';
  return `iit-sms:${run}:${host}`;
}

function clearLeaseFields() {
  return {
    claimedUntil: null,
    leaseExpiresAt: null,
    claimToken: null,
    claimedAt: null,
    claimedBy: null,
  };
}

function clearLeaseUpdate(extra = {}) {
  return { ...clearLeaseFields(), ...extra };
}

function isTerminalJob(job) {
  if (!job) return false;
  return ['dispatched', 'exhausted', 'cancelled', 'skipped'].includes(job.state);
}

async function expireDueTeluguSmsJobs(opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit != null ? opts.limit : 2000;
  const match = {
    state: 'pending',
    expiresAt: { $lte: now, $ne: null },
  };
  if (opts.messageKinds && opts.messageKinds.length) {
    match.messageKind = { $in: opts.messageKinds };
  }

  const ids = await IitTeluguSmsReminderJob.find(match).select('_id').limit(limit).lean();
  if (!ids.length) return { expired: 0 };

  const res = await IitTeluguSmsReminderJob.updateMany(
    { _id: { $in: ids.map((d) => d._id) } },
    {
      $set: {
        state: 'skipped',
        suppressionReason: 'expired',
        completedAt: now,
        expiredAt: now,
        updatedAt: now,
        ...clearLeaseFields(),
      },
    }
  );

  return { expired: res.modifiedCount || 0 };
}

async function recoverStuckTeluguSmsJobs(opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit != null ? opts.limit : 100;
  const staleClaimMs =
    parseInt(process.env.IIT_TELUGU_SMS_STALE_CLAIM_MS || '180000', 10) || 180000;
  const staleClaimBefore = new Date(now.getTime() - staleClaimMs);

  const stuckFilter = {
    state: { $in: ['claimed', 'dispatching'] },
    $or: [
      { leaseExpiresAt: { $lt: now } },
      { claimedUntil: { $lt: now } },
      { claimedAt: { $lt: staleClaimBefore } },
      { state: 'dispatching', updatedAt: { $lt: staleClaimBefore } },
    ],
  };
  if (opts.messageKinds && opts.messageKinds.length) {
    stuckFilter.messageKind = { $in: opts.messageKinds };
  }

  const res = await IitTeluguSmsReminderJob.updateMany(stuckFilter, {
    $set: { state: 'pending', updatedAt: now, ...clearLeaseFields() },
  });

  return { released: res.modifiedCount || 0 };
}

module.exports = {
  buildClaimedBy,
  clearLeaseFields,
  clearLeaseUpdate,
  isTerminalJob,
  expireDueTeluguSmsJobs,
  recoverStuckTeluguSmsJobs,
};
