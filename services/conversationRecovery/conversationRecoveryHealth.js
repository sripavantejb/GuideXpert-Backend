'use strict';

const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoverySchedulerRun = require('../../models/ConversationRecoverySchedulerRun');
const {
  getConversationRecoveryConfig,
} = require('./conversationRecoveryConfig');
const { getSystemMetricsSummary } = require('./conversationRecoveryMetrics');
const { countSentToday } = require('./conversationRecoveryDailyCounts');

async function getRecoveryHealth({ now = new Date() } = {}) {
  const config = getConversationRecoveryConfig();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastRun = await ConversationRecoverySchedulerRun.findOne({})
    .sort({ startedAt: -1 })
    .lean();

  const [
    queueSize,
    pendingJobs,
    messagesToday,
    failuresToday,
    sent,
    delivered,
    read,
    replied,
    recovered,
    booked,
  ] = await Promise.all([
    ConversationRecoveryAttempt.countDocuments({
      deliveryStatus: 'queued',
      scheduledFor: { $lte: now },
    }),
    ConversationRecoveryAttempt.countDocuments({ deliveryStatus: 'queued' }),
    countSentToday(now),
    ConversationRecoveryAttempt.countDocuments({
      deliveryStatus: 'failed',
      failedAt: { $gte: dayStart },
    }),
    ConversationRecoveryAttempt.countDocuments({
      sentAt: { $gte: dayStart },
      deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
    }),
    ConversationRecoveryAttempt.countDocuments({
      sentAt: { $gte: dayStart },
      deliveryStatus: { $in: ['delivered', 'read'] },
    }),
    ConversationRecoveryAttempt.countDocuments({
      sentAt: { $gte: dayStart },
      deliveryStatus: 'read',
    }),
    ConversationRecoveryAttempt.countDocuments({
      repliedAt: { $gte: dayStart },
    }),
    ConversationRecoveryCase.countDocuments({
      status: 'recovered',
      recoveredAt: { $gte: dayStart },
    }),
    ConversationRecoveryCase.countDocuments({
      bookingCompletedAfterRecovery: true,
      updatedAt: { $gte: dayStart },
    }),
  ]);

  const deliverySuccess = sent > 0 ? delivered / sent : 0;
  const recoverySuccess = sent > 0 ? recovered / sent : 0;
  const readRate = delivered > 0 ? read / delivered : 0;
  const replyRate = delivered > 0 ? replied / delivered : 0;
  const bookingConversion = recovered > 0 ? booked / recovered : 0;

  const staleMs = (config.alertSchedulerStaleMinutes || 45) * 60 * 1000;
  const schedulerHealthy =
    Boolean(lastRun?.success) &&
    lastRun?.startedAt &&
    now.getTime() - new Date(lastRun.startedAt).getTime() <= staleMs;

  return {
    serviceStatus: config.featureEnabled ? 'enabled' : 'disabled',
    schedulerStatus: schedulerHealthy ? 'healthy' : 'stale_or_stopped',
    lastSchedulerRun: lastRun
      ? {
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          durationMs: lastRun.durationMs,
          success: lastRun.success,
          sent: lastRun.sent,
          failed: lastRun.failed,
        }
      : null,
    queueSize,
    pendingJobs,
    messagesToday,
    failuresToday,
    recoverySuccessPct: recoverySuccess,
    deliverySuccessPct: deliverySuccess,
    readRate,
    replyRate,
    bookingConversion,
    templateConfigured: Boolean(config.templateId),
    systemMetrics: getSystemMetricsSummary(),
  };
}

module.exports = {
  getRecoveryHealth,
};
