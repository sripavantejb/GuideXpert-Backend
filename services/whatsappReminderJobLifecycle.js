/**
 * P3 hardening: monotonic job lifecycle, sync from events, repair and recovery.
 */
const os = require('os');
const mongoose = require('mongoose');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { RECONCILE_PENDING_STATUSES } = require('../utils/whatsappRetryRules');
const { isJobExpired } = require('../utils/waReminderJobExpiration');

const DELIVERED_PLUS = ['delivered', 'read'];
const TERMINAL_FAIL = ['failed', 'retry_exhausted'];

const JOB_STATE_RANK = {
  pending: 10,
  claimed: 20,
  dispatching: 30,
  dispatched: 40,
  reconcile_pending: 50,
  failed: 55,
  delivered: 60,
  read: 65,
  exhausted: 70,
  cancelled: 80,
  skipped: 80
};

const TERMINAL_SKIP_REASONS = new Set([
  'expired',
  'slot_passed',
  'invalid_schedule',
  'invalid_slot_date',
  'missing_registered_submission'
]);

function stateRank(state) {
  return JOB_STATE_RANK[state] != null ? JOB_STATE_RANK[state] : 0;
}

function isTerminalJob(job) {
  if (!job) return false;
  if (['delivered', 'read', 'exhausted', 'cancelled'].includes(job.state)) return true;
  if (job.state === 'skipped' && TERMINAL_SKIP_REASONS.has(job.suppressionReason)) return true;
  return false;
}

function buildClaimedBy(cronRunId) {
  const host = process.env.VERCEL_REGION || os.hostname() || 'worker';
  const run = cronRunId && mongoose.Types.ObjectId.isValid(String(cronRunId)) ? String(cronRunId) : 'cron';
  return `${run}:${host}`;
}

function clearLeaseFields() {
  return {
    claimedUntil: null,
    leaseExpiresAt: null,
    claimToken: null,
    claimedAt: null,
    claimedBy: null
  };
}

/**
 * @param {import('mongoose').Types.ObjectId|string} jobId
 * @param {string} nextState
 * @param {object} [fields]
 */
async function applyJobStateMonotonic(jobId, nextState, fields = {}) {
  const job = await WhatsAppReminderJob.findById(jobId).lean();
  if (!job) return null;
  const nextRank = stateRank(nextState);
  const curRank = stateRank(job.state);
  if (nextRank < curRank && !['skipped', 'cancelled'].includes(nextState)) {
    return { jobId, state: job.state, skipped: true, reason: 'rank_regression' };
  }
  const $set = { state: nextState, updatedAt: new Date(), ...fields };
  await WhatsAppReminderJob.updateOne({ _id: jobId }, { $set });
  return { jobId, state: nextState, skipped: false };
}

function deriveProjectionState(events, currentState) {
  const anyDelivered = events.some((e) => DELIVERED_PLUS.includes(e.status));
  const anyReconcile = events.some((e) => RECONCILE_PENDING_STATUSES.includes(e.status));
  const anyExhausted = events.some((e) => e.status === 'retry_exhausted');
  const anyPermanentFail = events.some(
    (e) => e.status === 'failed' && e.terminalFailureKind === 'permanent'
  );

  if (anyDelivered) {
    return events.some((e) => e.status === 'read') ? 'read' : 'delivered';
  }
  if (anyReconcile) return 'reconcile_pending';
  if (anyExhausted || anyPermanentFail) return 'exhausted';
  if (events.some((e) => TERMINAL_FAIL.includes(e.status))) return 'failed';
  if (events.length > 0 && ['pending', 'claimed', 'dispatching'].includes(currentState)) {
    return 'dispatched';
  }
  return currentState;
}

/**
 * @param {import('mongoose').Types.ObjectId|string} retryGroupId
 */
async function syncReminderJobFromRetryGroup(retryGroupId) {
  if (!retryGroupId) return null;
  const job = await WhatsAppReminderJob.findOne({ retryGroupId }).lean();
  if (!job) return null;
  if (isTerminalJob(job)) return { jobId: job._id, state: job.state, terminal: true };

  const events = await WhatsAppMessageEvent.find({ retryGroupId })
    .select('status attemptNumber _id updatedAt terminalFailureKind gupshupMessageId messageId')
    .sort({ attemptNumber: -1, updatedAt: -1 })
    .lean();

  if (!events.length) return null;

  const latest = events[0];
  const initial = events.find((e) => e.attemptNumber === 1) || events[events.length - 1];
  const state = deriveProjectionState(events, job.state);
  const providerMessageId = latest.gupshupMessageId || latest.messageId || job.providerMessageId || null;

  const $set = {
    latestMessageEventId: latest._id,
    providerMessageId,
    rootMessageEventId: initial._id,
    ...(initial ? { initialMessageEventId: initial._id } : {})
  };

  if (stateRank(state) >= stateRank(job.state)) {
    $set.state = state;
  }

  if (DELIVERED_PLUS.includes(state) || state === 'exhausted' || state === 'failed') {
    $set.completedAt = job.completedAt || new Date();
  }

  await WhatsAppReminderJob.updateOne({ _id: job._id }, { $set });
  return { jobId: job._id, state: $set.state || job.state };
}

/**
 * @param {{ now?: Date, limit?: number, messageKinds?: string[] }} [opts]
 */
async function expireDueReminderJobs(opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit != null ? opts.limit : 2000;
  const match = {
    state: 'pending',
    expiresAt: { $lte: now, $ne: null }
  };
  if (opts.messageKinds && opts.messageKinds.length) {
    match.messageKind = { $in: opts.messageKinds };
  }

  const ids = await WhatsAppReminderJob.find(match).select('_id').limit(limit).lean();
  if (!ids.length) return { expired: 0 };

  const res = await WhatsAppReminderJob.updateMany(
    { _id: { $in: ids.map((d) => d._id) } },
    {
      $set: {
        state: 'skipped',
        suppressionReason: 'expired',
        completedAt: now,
        expiredAt: now,
        updatedAt: now,
        ...clearLeaseFields()
      }
    }
  );

  return { expired: res.modifiedCount || 0 };
}

/**
 * @param {{ now?: Date, limit?: number, messageKinds?: string[] }} [opts]
 */
async function recoverStuckReminderJobs(opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit != null ? opts.limit : 100;
  const kinds = opts.messageKinds;

  const stuckFilter = {
    state: { $in: ['claimed', 'dispatching'] },
    $or: [
      { leaseExpiresAt: { $lt: now } },
      { claimedUntil: { $lt: now } },
      { leaseExpiresAt: null, claimedUntil: { $lt: now } }
    ]
  };
  if (kinds && kinds.length) stuckFilter.messageKind = { $in: kinds };

  const stuck = await WhatsAppReminderJob.find(stuckFilter).limit(limit).lean();
  let released = 0;
  let synced = 0;

  for (const job of stuck) {
    if (isTerminalJob(job)) continue;
    // eslint-disable-next-line no-await-in-loop
    const ev = job.retryGroupId
      ? await WhatsAppMessageEvent.findOne({
          retryGroupId: job.retryGroupId,
          attemptNumber: 1
        })
          .select('_id')
          .lean()
      : null;

    if (ev) {
      // eslint-disable-next-line no-await-in-loop
      await syncReminderJobFromRetryGroup(job.retryGroupId);
      synced += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await WhatsAppReminderJob.updateOne(
      { _id: job._id, state: { $in: ['claimed', 'dispatching'] } },
      {
        $set: {
          state: 'pending',
          updatedAt: now,
          ...clearLeaseFields()
        }
      }
    );
    released += 1;
  }

  return { released, synced, scanned: stuck.length };
}

/**
 * @param {{ now?: Date, limit?: number, messageKinds?: string[] }} [opts]
 */
async function repairReminderJobLifecycle(opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit != null ? opts.limit : 50;
  const staleDispatchMs =
    parseInt(process.env.WA_REMINDER_JOB_STALE_DISPATCH_MS || '600000', 10) || 600000;
  const staleBefore = new Date(now.getTime() - staleDispatchMs);

  let repaired = 0;
  let synced = 0;

  const dispatchingStale = await WhatsAppReminderJob.find({
    state: 'dispatching',
    updatedAt: { $lt: staleBefore }
  })
    .limit(limit)
    .lean();

  for (const job of dispatchingStale) {
    if (job.retryGroupId) {
      // eslint-disable-next-line no-await-in-loop
      const r = await syncReminderJobFromRetryGroup(job.retryGroupId);
      if (r) synced += 1;
      else if (!isTerminalJob(job)) {
        // eslint-disable-next-line no-await-in-loop
        await WhatsAppReminderJob.updateOne(
          { _id: job._id },
          { $set: { state: 'pending', updatedAt: now, ...clearLeaseFields() } }
        );
        repaired += 1;
      }
    }
  }

  const dispatchedNoEvent = await WhatsAppReminderJob.find({
    state: 'dispatched',
    initialMessageEventId: null,
    dispatchedAt: { $lt: staleBefore }
  })
    .limit(Math.max(0, limit - dispatchingStale.length))
    .lean();

  for (const job of dispatchedNoEvent) {
    if (!job.retryGroupId) continue;
    // eslint-disable-next-line no-await-in-loop
    const ev = await WhatsAppMessageEvent.findOne({
      retryGroupId: job.retryGroupId,
      attemptNumber: 1
    }).lean();
    if (ev) {
      // eslint-disable-next-line no-await-in-loop
      await syncReminderJobFromRetryGroup(job.retryGroupId);
      synced += 1;
    }
  }

  const pendingWithDelivered = await WhatsAppReminderJob.find({
    state: { $in: ['pending', 'claimed'] },
    retryGroupId: { $ne: null }
  })
    .limit(20)
    .lean();

  for (const job of pendingWithDelivered) {
    // eslint-disable-next-line no-await-in-loop
    const ev = await WhatsAppMessageEvent.findOne({
      retryGroupId: job.retryGroupId,
      status: { $in: DELIVERED_PLUS }
    }).lean();
    if (ev) {
      // eslint-disable-next-line no-await-in-loop
      await syncReminderJobFromRetryGroup(job.retryGroupId);
      synced += 1;
    }
  }

  return { repaired, synced };
}

module.exports = {
  JOB_STATE_RANK,
  stateRank,
  isTerminalJob,
  buildClaimedBy,
  clearLeaseFields,
  applyJobStateMonotonic,
  syncReminderJobFromRetryGroup,
  expireDueReminderJobs,
  recoverStuckReminderJobs,
  repairReminderJobLifecycle,
  isJobExpired
};
