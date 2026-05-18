/**
 * Live reconciliation backlog and health metrics for WhatsApp ops.
 */
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const MessagingCronRun = require('../models/MessagingCronRun');
const {
  dlrReconcileStaleMs,
  dlrReconcileGraceMs,
  RECONCILE_PENDING_STATUSES
} = require('./whatsappRetryRules');
const { getCronScheduleHealth } = require('./waCronScheduleHealth');

const CAMPAIGN_KINDS = ['pre4hr', 'meet', '30min'];
const STALE_SOURCE_STATUSES = ['submitted', 'sent'];
const AWAITING_STATUS = RECONCILE_PENDING_STATUSES[0];

function phase2BacklogThreshold() {
  return Math.max(
    50,
    parseInt(process.env.WA_RECONCILE_PHASE2_BACKLOG_WARN || '', 10) || 100
  );
}

/**
 * @returns {Promise<object>}
 */
async function getReconciliationObservability(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const staleMs = dlrReconcileStaleMs();
  const graceMs = dlrReconcileGraceMs();
  const staleBefore = new Date(now.getTime() - staleMs);
  const kindFilter = { messageKind: { $in: CAMPAIGN_KINDS } };

  const [
    awaitingCount,
    oldestAwaiting,
    phase1Backlog,
    phase2Backlog,
    resolutionSample,
    lastRetryCron,
    cronScheduleHealth
  ] = await Promise.all([
    WhatsAppMessageEvent.countDocuments({ ...kindFilter, status: AWAITING_STATUS }),
    WhatsAppMessageEvent.findOne({
      ...kindFilter,
      status: AWAITING_STATUS,
      reconcilePendingAt: { $ne: null }
    })
      .sort({ reconcilePendingAt: 1 })
      .select('reconcilePendingAt reconcileFinalityUntil')
      .lean(),
    WhatsAppMessageEvent.countDocuments({
      ...kindFilter,
      status: { $in: STALE_SOURCE_STATUSES },
      deliveredAt: null,
      readAt: null,
      $or: [
        { providerAcceptedAt: { $lte: staleBefore } },
        { providerAcceptedAt: null, createdAt: { $lte: staleBefore } }
      ]
    }),
    WhatsAppMessageEvent.countDocuments({
      ...kindFilter,
      status: AWAITING_STATUS,
      reconcileFinalityUntil: { $lte: now }
    }),
    WhatsAppMessageEvent.aggregate([
      {
        $match: {
          ...kindFilter,
          reconcileDerivedFailure: true,
          reconcilePendingAt: { $ne: null },
          failedAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $project: {
          resolutionMs: { $subtract: ['$failedAt', '$reconcilePendingAt'] }
        }
      },
      {
        $group: {
          _id: null,
          avgMs: { $avg: '$resolutionMs' },
          count: { $sum: 1 }
        }
      }
    ]),
    MessagingCronRun.findOne({ jobKey: 'retry_whatsapp', success: true, trigger: 'cron' })
      .sort({ finishedAt: -1 })
      .select('finishedAt stats')
      .lean(),
    getCronScheduleHealth()
  ]);

  const oldestAwaitingAgeMs =
    oldestAwaiting && oldestAwaiting.reconcilePendingAt
      ? now.getTime() - new Date(oldestAwaiting.reconcilePendingAt).getTime()
      : null;

  const avgResolutionMs =
    resolutionSample && resolutionSample[0] && Number.isFinite(resolutionSample[0].avgMs)
      ? Math.round(resolutionSample[0].avgMs)
      : null;

  const staleReconcileWarnings = [];
  if (oldestAwaitingAgeMs != null && oldestAwaitingAgeMs > graceMs * 2) {
    staleReconcileWarnings.push(
      `Oldest awaiting_final_dlr is ${Math.round(oldestAwaitingAgeMs / 60000)}m old (threshold ${Math.round((graceMs * 2) / 60000)}m)`
    );
  }
  if (phase2Backlog >= phase2BacklogThreshold()) {
    staleReconcileWarnings.push(
      `Phase-2 backlog ${phase2Backlog} rows ready to finalize (threshold ${phase2BacklogThreshold()})`
    );
  }
  const retryCronStale =
    cronScheduleHealth.jobs?.find((j) => j.jobKey === 'retry_whatsapp')?.stale === true;
  if (retryCronStale) {
    staleReconcileWarnings.push('retry_whatsapp cron last success is stale — reconciliation may be stranded');
  }

  const healthy =
    staleReconcileWarnings.length === 0 &&
    (awaitingCount === 0 || (oldestAwaitingAgeMs != null && oldestAwaitingAgeMs <= graceMs * 2));

  return {
    healthy,
    awaitingCount,
    oldestAwaitingAgeMs,
    oldestAwaitingPendingAt: oldestAwaiting?.reconcilePendingAt || null,
    phase1Backlog,
    phase2Backlog,
    avgResolutionMs,
    resolutionSampleCount: resolutionSample?.[0]?.count || 0,
    staleReconcileWarnings,
    graceMs,
    staleMs,
    lastRetryCron: lastRetryCron
      ? {
          finishedAt: lastRetryCron.finishedAt,
          reconcileStats: lastRetryCron.stats?.reconcile || lastRetryCron.stats?.waReconcile || null
        }
      : null,
    cronScheduleHealthy: cronScheduleHealth.healthy
  };
}

module.exports = {
  getReconciliationObservability,
  CAMPAIGN_KINDS,
  AWAITING_STATUS
};
