'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const { getCopilotHotLeadThreshold } = require('./humanCopilotFlags');
const { COPILOT_QUEUE_STATES } = require('./humanCopilotConstants');

const ESCALATION_REASONS = Object.freeze([
  { key: 'human_requested', label: 'Explicit human request' },
  { key: 'low_confidence', label: 'Low confidence' },
  { key: 'hot_lead', label: 'Hot lead' },
  { key: 'reopened', label: 'Reopened conversation' },
]);

function parseSinceDays(sinceDays = 30) {
  const days = Math.min(Math.max(parseInt(sinceDays, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { days, since };
}

function baseMatch(since) {
  return { route: 'admin_pool', createdAt: { $gte: since } };
}

function buildMeta(sinceDays) {
  const { days, since } = parseSinceDays(sinceDays);
  return { sinceDays: days, since, generatedAt: new Date() };
}

function percent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function deriveEscalationReasons(handoff, leadScore) {
  const reasons = [];
  if (handoff.reason === 'user_requested') reasons.push('human_requested');
  if (handoff.reason === 'low_confidence') reasons.push('low_confidence');
  if (handoff.isReopened || handoff.reason === 'reopened' || handoff.copilotState === 'reopened') {
    reasons.push('reopened');
  }
  const threshold = getCopilotHotLeadThreshold();
  if (leadScore != null && leadScore >= threshold) reasons.push('hot_lead');
  return reasons;
}

function emptyWorkload() {
  return { assigned: 0, resolved: 0, avgFirstResponseMs: 0 };
}

async function getAnalyticsOverview({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const match = baseMatch(meta.since);

  const [
    total,
    resolved,
    reopened,
    active,
    responseAgg,
    resolutionAgg,
  ] = await Promise.all([
    WhatsAppAgentHandoff.countDocuments(match),
    WhatsAppAgentHandoff.countDocuments({ ...match, status: 'resolved' }),
    WhatsAppAgentHandoff.countDocuments({ ...match, isReopened: true }),
    WhatsAppAgentHandoff.countDocuments({
      route: 'admin_pool',
      copilotState: { $in: COPILOT_QUEUE_STATES },
      status: { $in: ['open', 'claimed'] },
    }),
    WhatsAppAgentHandoff.aggregate([
      { $match: { ...match, firstResponseAt: { $ne: null } } },
      { $project: { responseMs: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
      {
        $group: {
          _id: null,
          avgMs: { $avg: '$responseMs' },
          maxMs: { $max: '$responseMs' },
        },
      },
    ]),
    WhatsAppAgentHandoff.aggregate([
      { $match: { ...match, resolvedAt: { $ne: null } } },
      { $project: { resolutionMs: { $subtract: ['$resolvedAt', '$createdAt'] } } },
      {
        $group: {
          _id: null,
          avgMs: { $avg: '$resolutionMs' },
          maxMs: { $max: '$resolutionMs' },
        },
      },
    ]),
  ]);

  return {
    meta,
    data: {
      volume: { total, active, resolved, reopened },
      responseTimes: {
        avgFirstResponseMs: Math.round(responseAgg[0]?.avgMs || 0),
        maxFirstResponseMs: Math.round(responseAgg[0]?.maxMs || 0),
        avgResolutionMs: Math.round(resolutionAgg[0]?.avgMs || 0),
        maxResolutionMs: Math.round(resolutionAgg[0]?.maxMs || 0),
      },
    },
  };
}

async function workloadForSr(match, sr) {
  const [assigned, resolved, responseAgg] = await Promise.all([
    WhatsAppAgentHandoff.countDocuments({ ...match, assignedSrCounsellor: sr }),
    WhatsAppAgentHandoff.countDocuments({
      ...match,
      assignedSrCounsellor: sr,
      status: 'resolved',
    }),
    WhatsAppAgentHandoff.aggregate([
      {
        $match: {
          ...match,
          assignedSrCounsellor: sr,
          firstResponseAt: { $ne: null },
        },
      },
      { $project: { responseMs: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
      { $group: { _id: null, avgMs: { $avg: '$responseMs' } } },
    ]),
  ]);
  return {
    assigned,
    resolved,
    avgFirstResponseMs: Math.round(responseAgg[0]?.avgMs || 0),
  };
}

async function getAnalyticsWorkloads({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const match = baseMatch(meta.since);
  const [sr1, sr2] = await Promise.all([
    workloadForSr(match, 'sr1'),
    workloadForSr(match, 'sr2'),
  ]);
  return { meta, data: { sr1, sr2 } };
}

async function getAnalyticsAiUsage({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const match = baseMatch(meta.since);

  const [suggestAgg, replyAgg] = await Promise.all([
    WhatsAppAgentHandoff.aggregate([
      { $match: match },
      { $unwind: '$auditTrail' },
      { $match: { 'auditTrail.action': 'suggest_requested' } },
      { $count: 'count' },
    ]),
    WhatsAppAgentHandoff.aggregate([
      { $match: match },
      { $unwind: '$copilotReplies' },
      { $match: { 'copilotReplies.status': 'sent' } },
      {
        $group: {
          _id: '$copilotReplies.replySource',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const bySource = {};
  for (const row of replyAgg) {
    bySource[row._id || 'manual'] = row.count;
  }

  const accepted = bySource.ai_used || 0;
  const edited = bySource.ai_edited || 0;
  const manual = bySource.manual || 0;
  const aiDenom = accepted + edited;

  return {
    meta,
    data: {
      totalSuggestedReplies: suggestAgg[0]?.count || 0,
      accepted,
      edited,
      manual,
      acceptanceRate: aiDenom > 0 ? roundRate(accepted / aiDenom) : 0,
    },
  };
}

async function getAnalyticsEscalations({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const match = baseMatch(meta.since);
  const hotThreshold = getCopilotHotLeadThreshold();

  const [totalHandoffs, rows] = await Promise.all([
    WhatsAppAgentHandoff.countDocuments(match),
    WhatsAppAgentHandoff.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'whatsappleadscores',
          localField: 'phone',
          foreignField: 'phone',
          as: 'scoreDoc',
        },
      },
      {
        $addFields: {
          leadScore: { $arrayElemAt: ['$scoreDoc.leadScore', 0] },
        },
      },
      {
        $project: {
          reason: 1,
          isReopened: 1,
          copilotState: 1,
          human_requested: {
            $cond: [{ $eq: ['$reason', 'user_requested'] }, 1, 0],
          },
          low_confidence: {
            $cond: [{ $eq: ['$reason', 'low_confidence'] }, 1, 0],
          },
          reopened: {
            $cond: [
              {
                $or: [
                  { $eq: ['$isReopened', true] },
                  { $eq: ['$reason', 'reopened'] },
                  { $eq: ['$copilotState', 'reopened'] },
                ],
              },
              1,
              0,
            ],
          },
          hot_lead: {
            $cond: [{ $gte: ['$leadScore', hotThreshold] }, 1, 0],
          },
        },
      },
      {
        $group: {
          _id: null,
          human_requested: { $sum: '$human_requested' },
          low_confidence: { $sum: '$low_confidence' },
          hot_lead: { $sum: '$hot_lead' },
          reopened: { $sum: '$reopened' },
        },
      },
    ]),
  ]);

  const counts = rows[0] || {};
  const reasons = ESCALATION_REASONS.map(({ key, label }) => ({
    key,
    label,
    count: counts[key] || 0,
    percent: percent(counts[key] || 0, totalHandoffs),
  }));

  return { meta, data: { totalHandoffs, reasons } };
}

async function getAnalyticsDelivery({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const match = baseMatch(meta.since);

  const [replyAgg, retryAgg, retrySuccessAgg] = await Promise.all([
    WhatsAppAgentHandoff.aggregate([
      { $match: match },
      { $unwind: '$copilotReplies' },
      {
        $group: {
          _id: '$copilotReplies.status',
          count: { $sum: 1 },
        },
      },
    ]),
    WhatsAppAgentHandoff.aggregate([
      { $match: match },
      { $unwind: '$auditTrail' },
      { $match: { 'auditTrail.action': 'reply_retried' } },
      { $count: 'count' },
    ]),
    WhatsAppAgentHandoff.aggregate([
      { $match: match },
      { $unwind: '$copilotReplies' },
      {
        $addFields: {
          retried: {
            $filter: {
              input: '$auditTrail',
              as: 'a',
              cond: {
                $and: [
                  { $eq: ['$$a.action', 'reply_retried'] },
                  { $eq: ['$$a.meta.replyId', { $toString: '$copilotReplies._id' }] },
                ],
              },
            },
          },
        },
      },
      {
        $match: {
          'copilotReplies.status': 'sent',
          $expr: { $gt: [{ $size: '$retried' }, 0] },
        },
      },
      { $count: 'count' },
    ]),
  ]);

  const byStatus = {};
  for (const row of replyAgg) {
    byStatus[row._id] = row.count;
  }

  const retries = retryAgg[0]?.count || 0;
  const retrySuccesses = retrySuccessAgg[0]?.count || 0;

  return {
    meta,
    data: {
      successfulSends: byStatus.sent || 0,
      failedSends: byStatus.failed || 0,
      retries,
      retrySuccessRate: retries > 0 ? roundRate(retrySuccesses / retries) : 0,
    },
  };
}

async function getAnalyticsLeadQuality({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const match = baseMatch(meta.since);

  const rows = await WhatsAppAgentHandoff.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'whatsappleadscores',
        localField: 'phone',
        foreignField: 'phone',
        as: 'scoreDoc',
      },
    },
    {
      $addFields: {
        leadStage: { $arrayElemAt: ['$scoreDoc.leadStage', 0] },
        leadScore: { $arrayElemAt: ['$scoreDoc.leadScore', 0] },
      },
    },
    {
      $group: {
        _id: null,
        cold: { $sum: { $cond: [{ $eq: ['$leadStage', 'cold'] }, 1, 0] } },
        warm: { $sum: { $cond: [{ $eq: ['$leadStage', 'warm'] }, 1, 0] } },
        hot: { $sum: { $cond: [{ $eq: ['$leadStage', 'hot'] }, 1, 0] } },
        unscored: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$leadStage', null] },
                  { $not: ['$leadStage'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        avgScore: { $avg: '$leadScore' },
      },
    },
  ]);

  const agg = rows[0] || {};
  return {
    meta,
    data: {
      cold: agg.cold || 0,
      warm: agg.warm || 0,
      hot: agg.hot || 0,
      unscored: agg.unscored || 0,
      averageLeadScore: agg.avgScore != null ? Math.round(agg.avgScore * 10) / 10 : 0,
    },
  };
}

module.exports = {
  parseSinceDays,
  baseMatch,
  percent,
  deriveEscalationReasons,
  emptyWorkload,
  getAnalyticsOverview,
  getAnalyticsWorkloads,
  getAnalyticsAiUsage,
  getAnalyticsEscalations,
  getAnalyticsDelivery,
  getAnalyticsLeadQuality,
  ESCALATION_REASONS,
};
