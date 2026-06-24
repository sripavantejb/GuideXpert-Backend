'use strict';

const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const LeadLifecycleEvent = require('../../models/LeadLifecycleEvent');

function parseSinceDays(sinceDays = 30) {
  const days = Math.min(Math.max(parseInt(sinceDays, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { days, since };
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

async function loadLifecycleStagePhones(stages = []) {
  if (!stages.length) return new Set();
  const phones = await LeadLifecycleEvent.distinct('phone10', { stage: { $in: stages } });
  return new Set(phones);
}

async function getFollowupEffectiveness({ sinceDays = 30 } = {}) {
  const { days, since } = parseSinceDays(sinceDays);

  const sentFollowups = await WhatsAppAgentHandoff.aggregate([
    { $match: { route: 'admin_pool', 'copilotFollowups.sentAt': { $gte: since } } },
    { $unwind: '$copilotFollowups' },
    { $match: { 'copilotFollowups.status': 'sent', 'copilotFollowups.sentAt': { $gte: since } } },
    {
      $project: {
        phone: 1,
        productLine: 1,
        sentAt: '$copilotFollowups.sentAt',
        replied: { $cond: [{ $ne: ['$copilotFollowups.responseReceived', null] }, 1, 0] },
      },
    },
  ]);

  const followupsSent = sentFollowups.length;
  const replies = sentFollowups.filter((row) => row.replied).length;
  const phones = [...new Set(sentFollowups.map((r) => r.phone).filter(Boolean))];

  const [bookedPhones, admissionPhones] = await Promise.all([
    loadLifecycleStagePhones(['booked', 'attended', 'admission']),
    loadLifecycleStagePhones(['admission']),
  ]);

  const bookings = phones.filter((p) => bookedPhones.has(p)).length;
  const conversions = phones.filter((p) => admissionPhones.has(p)).length;

  return {
    meta: { sinceDays: days, since, generatedAt: new Date() },
    followupsSent,
    replies,
    bookings,
    conversions,
    replyRate: pct(replies, followupsSent),
    bookingRate: pct(bookings, followupsSent),
    conversionRate: pct(conversions, followupsSent),
  };
}

module.exports = {
  getFollowupEffectiveness,
  parseSinceDays,
  pct,
};
