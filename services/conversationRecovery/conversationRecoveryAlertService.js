'use strict';

const ConversationRecoveryAlert = require('../../models/ConversationRecoveryAlert');
const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoverySchedulerRun = require('../../models/ConversationRecoverySchedulerRun');
const {
  getConversationRecoveryConfig,
} = require('./conversationRecoveryConfig');

async function upsertOpenAlert({
  alertKey,
  title,
  message,
  severity = 'warning',
  metric = null,
  value = null,
  threshold = null,
  metadata = {},
}) {
  const existing = await ConversationRecoveryAlert.findOne({
    alertKey,
    status: { $in: ['open', 'acknowledged'] },
  });
  if (existing) {
    await ConversationRecoveryAlert.updateOne(
      { _id: existing._id },
      {
        $set: {
          title,
          message,
          severity,
          metric,
          value,
          threshold,
          metadata,
        },
      }
    );
    return existing;
  }
  return ConversationRecoveryAlert.create({
    alertKey,
    title,
    message,
    severity,
    status: 'open',
    metric,
    value,
    threshold,
    metadata,
  });
}

async function resolveAlertByKey(alertKey) {
  await ConversationRecoveryAlert.updateMany(
    { alertKey, status: { $in: ['open', 'acknowledged'] } },
    { $set: { status: 'resolved', resolvedAt: new Date() } }
  );
}

async function evaluateAndUpsertAlerts({ now = new Date() } = {}) {
  const config = getConversationRecoveryConfig();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const alerts = [];

  if (!config.templateId) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'template_missing',
        title: 'Template missing',
        message:
          'GUPSHUP_TEMPLATE_CONVERSATION_RECOVERY is not configured. Recovery sends will fail.',
        severity: 'critical',
        metric: 'templateId',
        value: 0,
        threshold: 1,
      })
    );
  } else {
    await resolveAlertByKey('template_missing');
  }

  if (!config.featureEnabled) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'campaign_disabled',
        title: 'Campaign disabled',
        message: 'Conversation Recovery feature is disabled in admin config.',
        severity: 'info',
        metric: 'featureEnabled',
        value: 0,
        threshold: 1,
      })
    );
  } else {
    await resolveAlertByKey('campaign_disabled');
  }

  const lastRun = await ConversationRecoverySchedulerRun.findOne({})
    .sort({ startedAt: -1 })
    .lean();
  const staleMs = (config.alertSchedulerStaleMinutes || 45) * 60 * 1000;
  if (!lastRun || now.getTime() - new Date(lastRun.startedAt).getTime() > staleMs) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'scheduler_stopped',
        title: 'Scheduler stopped / stale',
        message: `No successful scheduler run within ${config.alertSchedulerStaleMinutes} minutes.`,
        severity: 'critical',
        metric: 'scheduler_stale_minutes',
        value: lastRun
          ? (now.getTime() - new Date(lastRun.startedAt).getTime()) / 60000
          : null,
        threshold: config.alertSchedulerStaleMinutes,
      })
    );
  } else {
    await resolveAlertByKey('scheduler_stopped');
  }

  const queueSize = await ConversationRecoveryAttempt.countDocuments({
    deliveryStatus: 'queued',
    scheduledFor: { $lte: now },
  });
  if (queueSize > (config.alertQueueBacklogMax || 200)) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'queue_backlog',
        title: 'Queue backlog',
        message: `Pending due queue size is ${queueSize}.`,
        severity: 'warning',
        metric: 'queue_size',
        value: queueSize,
        threshold: config.alertQueueBacklogMax,
      })
    );
  } else {
    await resolveAlertByKey('queue_backlog');
  }

  const sentToday = await ConversationRecoveryAttempt.countDocuments({
    sentAt: { $gte: dayAgo },
    deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
  });
  const deliveredToday = await ConversationRecoveryAttempt.countDocuments({
    sentAt: { $gte: dayAgo },
    deliveryStatus: { $in: ['delivered', 'read'] },
  });
  const failedToday = await ConversationRecoveryAttempt.countDocuments({
    failedAt: { $gte: dayAgo },
    deliveryStatus: 'failed',
  });
  const deliveryRate = sentToday > 0 ? deliveredToday / sentToday : 1;
  const failureRate =
    sentToday + failedToday > 0 ? failedToday / (sentToday + failedToday) : 0;

  if (sentToday >= 5 && deliveryRate < (config.alertDeliverySuccessMin || 0.7)) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'delivery_success_low',
        title: 'Delivery success below threshold',
        message: `Delivery success ${(deliveryRate * 100).toFixed(1)}% < ${(config.alertDeliverySuccessMin * 100).toFixed(0)}%.`,
        severity: 'warning',
        metric: 'delivery_success',
        value: deliveryRate,
        threshold: config.alertDeliverySuccessMin,
      })
    );
  } else {
    await resolveAlertByKey('delivery_success_low');
  }

  if (sentToday + failedToday >= 5 && failureRate > (config.alertFailureRateMax || 0.25)) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'high_failure_rate',
        title: 'High failure rate',
        message: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold.`,
        severity: 'critical',
        metric: 'failure_rate',
        value: failureRate,
        threshold: config.alertFailureRateMax,
      })
    );
  } else {
    await resolveAlertByKey('high_failure_rate');
  }

  const dlrCutoff = new Date(
    now.getTime() - (config.alertDlrMissingMinutes || 60) * 60 * 1000
  );
  const dlrMissing = await ConversationRecoveryAttempt.countDocuments({
    deliveryStatus: 'sent',
    sentAt: { $lte: dlrCutoff },
  });
  if (dlrMissing > 10) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'dlr_missing',
        title: 'DLR missing',
        message: `${dlrMissing} messages still in sent without DLR after ${config.alertDlrMissingMinutes}m.`,
        severity: 'warning',
        metric: 'dlr_missing',
        value: dlrMissing,
        threshold: 10,
      })
    );
  } else {
    await resolveAlertByKey('dlr_missing');
  }

  const retriesToday = await ConversationRecoveryAttempt.countDocuments({
    attemptNumber: { $gte: 2 },
    createdAt: { $gte: dayAgo },
  });
  if (retriesToday > 50) {
    alerts.push(
      await upsertOpenAlert({
        alertKey: 'retry_spike',
        title: 'Retry spike',
        message: `${retriesToday} retry attempts created in the last 24h.`,
        severity: 'warning',
        metric: 'retry_count',
        value: retriesToday,
        threshold: 50,
      })
    );
  } else {
    await resolveAlertByKey('retry_spike');
  }

  return alerts.filter(Boolean);
}

async function listAlerts({ status = 'open', limit = 50 } = {}) {
  const match = {};
  if (status && status !== 'all') match.status = status;
  return ConversationRecoveryAlert.find(match)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function acknowledgeAlert(id) {
  return ConversationRecoveryAlert.findByIdAndUpdate(
    id,
    { $set: { status: 'acknowledged', acknowledgedAt: new Date() } },
    { new: true }
  );
}

async function resolveAlert(id) {
  return ConversationRecoveryAlert.findByIdAndUpdate(
    id,
    { $set: { status: 'resolved', resolvedAt: new Date() } },
    { new: true }
  );
}

module.exports = {
  evaluateAndUpsertAlerts,
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  upsertOpenAlert,
};
