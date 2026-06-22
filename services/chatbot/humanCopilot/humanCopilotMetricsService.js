'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const { getAnalyticsOverview } = require('./humanCopilotAnalyticsService');
const { getCopilotHotLeadThreshold } = require('./humanCopilotFlags');
const { COPILOT_QUEUE_STATES } = require('./humanCopilotConstants');

async function getCopilotMetrics({ sinceDays = 30 } = {}) {
  const { meta, data } = await getAnalyticsOverview({ sinceDays });
  const hotThreshold = getCopilotHotLeadThreshold();
  const baseMatch = { route: 'admin_pool', createdAt: { $gte: meta.since } };

  const [hotLeadHandoffs, sr1Workload, sr2Workload] = await Promise.all([
    WhatsAppAgentHandoff.aggregate([
      { $match: baseMatch },
      {
        $lookup: {
          from: 'whatsappleadscores',
          localField: 'phone',
          foreignField: 'phone',
          as: 'score',
        },
      },
      { $unwind: { path: '$score', preserveNullAndEmptyArrays: false } },
      { $match: { 'score.leadScore': { $gte: hotThreshold } } },
      { $count: 'count' },
    ]),
    WhatsAppAgentHandoff.countDocuments({
      ...baseMatch,
      assignedSrCounsellor: 'sr1',
      status: { $in: ['open', 'claimed', 'resolved'] },
    }),
    WhatsAppAgentHandoff.countDocuments({
      ...baseMatch,
      assignedSrCounsellor: 'sr2',
      status: { $in: ['open', 'claimed', 'resolved'] },
    }),
  ]);

  const queueDepth = await WhatsAppAgentHandoff.countDocuments({
    route: 'admin_pool',
    copilotState: { $in: COPILOT_QUEUE_STATES },
    status: { $in: ['open', 'claimed'] },
  });

  const reopenRate =
    data.volume.resolved > 0
      ? Math.round((data.volume.reopened / data.volume.resolved) * 1000) / 1000
      : 0;

  return {
    sinceDays: meta.sinceDays,
    since: meta.since,
    totalHandoffs: data.volume.total,
    resolvedCount: data.volume.resolved,
    reopenedCount: data.volume.reopened,
    reopenRate,
    hotLeadCount: hotLeadHandoffs[0]?.count || 0,
    sr1Workload,
    sr2Workload,
    averageResponseTimeMs: data.responseTimes.avgFirstResponseMs,
    queueDepth,
  };
}

module.exports = {
  getCopilotMetrics,
};
