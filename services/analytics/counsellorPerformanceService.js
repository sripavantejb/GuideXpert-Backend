'use strict';

const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const LeadLifecycleEvent = require('../../models/LeadLifecycleEvent');
const WhatsAppLeadScore = require('../../models/WhatsAppLeadScore');
const { getCopilotHotLeadThreshold } = require('../chatbot/humanCopilot/humanCopilotFlags');

function parseSinceDays(sinceDays = 30) {
  const days = Math.min(Math.max(parseInt(sinceDays, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { days, since };
}

async function loadLifecycleSets() {
  const [booked, admission, hotQualified] = await Promise.all([
    LeadLifecycleEvent.distinct('phone10', { stage: { $in: ['booked', 'attended', 'admission'] } }),
    LeadLifecycleEvent.distinct('phone10', { stage: 'admission' }),
    WhatsAppLeadScore.distinct('phone', { leadStage: 'hot' }),
  ]);
  return {
    booked: new Set(booked),
    admission: new Set(admission),
    hot: new Set(hotQualified),
  };
}

async function metricsForCounsellor(sr, since) {
  const match = {
    route: 'admin_pool',
    assignedSrCounsellor: sr,
    createdAt: { $gte: since },
  };

  const [sessionsHandled, responseAgg, handoffs] = await Promise.all([
    WhatsAppAgentHandoff.countDocuments(match),
    WhatsAppAgentHandoff.aggregate([
      {
        $match: {
          ...match,
          firstResponseAt: { $ne: null },
        },
      },
      { $project: { responseMs: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
      { $group: { _id: null, avgMs: { $avg: '$responseMs' } } },
    ]),
    WhatsAppAgentHandoff.find(match).select('phone').lean(),
  ]);

  const phones = [...new Set(handoffs.map((h) => h.phone).filter(Boolean))];
  const lifecycle = await loadLifecycleSets();

  const bookingsGenerated = phones.filter((p) => lifecycle.booked.has(p)).length;
  const admissionsGenerated = phones.filter((p) => lifecycle.admission.has(p)).length;
  const hotLeadsConverted = phones.filter((p) => lifecycle.hot.has(p) && lifecycle.admission.has(p)).length;

  return {
    counsellorId: sr,
    sessionsHandled,
    avgResponseTime: Math.round(responseAgg[0]?.avgMs || 0),
    bookingsGenerated,
    admissionsGenerated,
    hotLeadsConverted,
    hotLeadThreshold: getCopilotHotLeadThreshold(),
  };
}

async function getCounsellorPerformance({ sinceDays = 30 } = {}) {
  const { days, since } = parseSinceDays(sinceDays);
  const [sr1, sr2] = await Promise.all([
    metricsForCounsellor('sr1', since),
    metricsForCounsellor('sr2', since),
  ]);

  return {
    meta: { sinceDays: days, since, generatedAt: new Date() },
    counsellors: [sr1, sr2],
  };
}

module.exports = {
  getCounsellorPerformance,
  parseSinceDays,
  metricsForCounsellor,
};
