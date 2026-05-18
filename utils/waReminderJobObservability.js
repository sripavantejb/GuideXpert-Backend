/**
 * P3: Operational aggregates for WhatsAppReminderJob queue health.
 */
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');

function overdueSlaMs() {
  return Math.max(
    60 * 1000,
    parseInt(process.env.WA_REMINDER_JOB_OVERDUE_SLA_MS || '120000', 10) || 120000
  );
}

function stuckClaimMs() {
  return Math.max(
    60 * 1000,
    parseInt(process.env.WA_REMINDER_JOB_STUCK_CLAIM_MS || '300000', 10) || 300000
  );
}

async function countLifecycleMismatches(match, now, stuckBefore) {
  const staleDispatchMs =
    parseInt(process.env.WA_REMINDER_JOB_STALE_DISPATCH_MS || '600000', 10) || 600000;
  const staleBefore = new Date(now.getTime() - staleDispatchMs);

  const [dispatchedWithoutEvent, staleDispatching, pendingWithDeliveredEvent] = await Promise.all([
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: 'dispatched',
      initialMessageEventId: null,
      dispatchedAt: { $lt: staleBefore }
    }),
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: 'dispatching',
      updatedAt: { $lt: staleBefore }
    }),
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: { $in: ['pending', 'claimed'] },
      retryGroupId: { $ne: null }
    })
  ]);

  let eventDeliveredJobNot = 0;
  if (pendingWithDeliveredEvent > 0) {
    const sample = await WhatsAppReminderJob.find({
      ...match,
      state: { $in: ['pending', 'claimed'] },
      retryGroupId: { $ne: null }
    })
      .select('retryGroupId')
      .limit(50)
      .lean();
    const groupIds = sample.map((j) => j.retryGroupId).filter(Boolean);
    if (groupIds.length) {
      const deliveredGroups = await WhatsAppMessageEvent.distinct('retryGroupId', {
        retryGroupId: { $in: groupIds },
        status: { $in: ['delivered', 'read'] }
      });
      eventDeliveredJobNot = deliveredGroups.length;
    }
  }

  return {
    dispatchedWithoutEvent,
    staleDispatching,
    eventDeliveredJobNot
  };
}

/**
 * @param {{ slotDayIst?: string|null, messageKind?: string|null }} [filter]
 */
async function getReminderJobObservability(filter = {}) {
  const now = new Date();
  const overdueBefore = new Date(now.getTime() - overdueSlaMs());
  const stuckBefore = new Date(now.getTime() - stuckClaimMs());

  const match = {};
  if (filter.slotDayIst) match.slotDayIst = filter.slotDayIst;
  if (filter.messageKind) match.messageKind = filter.messageKind;

  const [
    pending,
    overdue,
    claimed,
    stuckClaimed,
    dispatching,
    dispatched,
    failed,
    exhausted,
    skipped,
    expired,
    cancelled,
    delivered,
    read,
    reconcilePending,
    delayAgg,
    lifecycleMismatch
  ] = await Promise.all([
    WhatsAppReminderJob.countDocuments({ ...match, state: 'pending' }),
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: 'pending',
      scheduledSendAt: { $lte: overdueBefore }
    }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'claimed' }),
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: { $in: ['claimed', 'dispatching'] },
      $or: [{ claimedUntil: { $lt: stuckBefore } }, { leaseExpiresAt: { $lt: stuckBefore } }]
    }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'dispatching' }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'dispatched' }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'failed' }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'exhausted' }),
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: 'skipped',
      suppressionReason: { $ne: 'expired' }
    }),
    WhatsAppReminderJob.countDocuments({
      ...match,
      state: 'skipped',
      suppressionReason: 'expired'
    }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'cancelled' }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'delivered' }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'read' }),
    WhatsAppReminderJob.countDocuments({ ...match, state: 'reconcile_pending' }),
    WhatsAppReminderJob.aggregate([
      { $match: { ...match, dispatchedAt: { $ne: null }, scheduledSendAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          avgDelayMs: { $avg: { $subtract: ['$dispatchedAt', '$scheduledSendAt'] } },
          maxDelayMs: { $max: { $subtract: ['$dispatchedAt', '$scheduledSendAt'] } },
          count: { $sum: 1 }
        }
      }
    ]),
    countLifecycleMismatches(match, now, stuckBefore)
  ]);

  const d = delayAgg[0] || {};
  const mismatchTotal =
    lifecycleMismatch.dispatchedWithoutEvent +
    lifecycleMismatch.staleDispatching +
    lifecycleMismatch.eventDeliveredJobNot;

  return {
    asOf: now.toISOString(),
    filter: filter.slotDayIst || filter.messageKind ? filter : null,
    overdueSlaMs: overdueSlaMs(),
    stuckClaimMs: stuckClaimMs(),
    counts: {
      pending,
      overdue,
      claimed,
      stuckClaimed,
      dispatching,
      dispatched,
      failed,
      exhausted,
      skipped,
      expired,
      cancelled,
      delivered,
      read,
      reconcilePending
    },
    lifecycleMismatch,
    schedulingDelay: {
      sampleCount: d.count || 0,
      avgMs: d.avgDelayMs != null ? Math.round(d.avgDelayMs) : null,
      maxMs: d.maxDelayMs != null ? Math.round(d.maxDelayMs) : null
    },
    healthy: overdue === 0 && stuckClaimed === 0 && mismatchTotal === 0
  };
}

module.exports = {
  getReminderJobObservability,
  overdueSlaMs,
  stuckClaimMs,
  countLifecycleMismatches
};
