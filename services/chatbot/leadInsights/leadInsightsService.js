'use strict';

const WhatsAppLeadProfile = require('../../../models/WhatsAppLeadProfile');
const WhatsAppLeadScore = require('../../../models/WhatsAppLeadScore');
const WhatsAppLeadEvent = require('../../../models/WhatsAppLeadEvent');

const VALID_STAGES = new Set(['cold', 'warm', 'hot']);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const RECENT_EVENTS_LIMIT = 20;
const HOT_LEADS_LIMIT = 50;

const PROFILE_LIST_PROJECTION =
  'phone branchInterest collegeInterest eventCount lastInteractionAt conversationId';
const SCORE_LIST_PROJECTION =
  'phone leadScore leadStage scoreReasons confidence lastScoredAt conversationId';
const EVENT_DETAIL_PROJECTION =
  'conversationId phone inboundMessageId outboundMessageId intent intentReason productLine events assistantType extractionModel createdAt';

function normalizePhone10(phone) {
  const phone10 = String(phone || '').trim();
  return /^\d{10}$/.test(phone10) ? phone10 : null;
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseMinScore(value) {
  if (value == null || value === '') {
    return { minScore: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { error: 'Invalid minScore. Expected a number between 0 and 100.' };
  }
  if (parsed < 0 || parsed > 100) {
    return { error: 'Invalid minScore. Expected a number between 0 and 100.' };
  }
  return { minScore: parsed };
}

function parseStage(value) {
  if (value == null || value === '') {
    return { stage: null };
  }
  const stage = String(value).trim().toLowerCase();
  if (!VALID_STAGES.has(stage)) {
    return { error: 'Invalid stage. Expected cold, warm, or hot.' };
  }
  return { stage };
}

function mapListItem(scoreDoc = {}, profileDoc = {}) {
  return {
    phone: scoreDoc.phone || profileDoc.phone || null,
    leadScore: scoreDoc.leadScore ?? null,
    leadStage: scoreDoc.leadStage ?? null,
    branchInterest: profileDoc.branchInterest ?? null,
    collegeInterest: profileDoc.collegeInterest ?? null,
    eventCount: profileDoc.eventCount ?? 0,
    lastInteractionAt: profileDoc.lastInteractionAt ?? null,
  };
}

async function getLeadDetails(phone) {
  const phone10 = normalizePhone10(phone);
  if (!phone10) {
    return { error: 'Invalid phone. Expected 10 digits.' };
  }

  const [profile, score, recentEvents] = await Promise.all([
    WhatsAppLeadProfile.findOne({ phone: phone10 }).select(PROFILE_LIST_PROJECTION).lean(),
    WhatsAppLeadScore.findOne({ phone: phone10 }).select(SCORE_LIST_PROJECTION).lean(),
    WhatsAppLeadEvent.find({ phone: phone10 })
      .select(EVENT_DETAIL_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(RECENT_EVENTS_LIMIT)
      .lean(),
  ]);

  return {
    profile: profile || null,
    score: score || null,
    recentEvents: recentEvents || [],
  };
}

async function listLeads({ stage = null, minScore = null, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) {
  const match = {};
  if (stage) {
    match.leadStage = stage;
  }
  if (minScore != null) {
    match.leadScore = { $gte: minScore };
  }

  const safePage = parsePositiveInt(page, DEFAULT_PAGE);
  const safeLimit = parsePositiveInt(limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (safePage - 1) * safeLimit;

  const [result] = await WhatsAppLeadScore.aggregate([
    { $match: match },
    {
      $lookup: {
        from: WhatsAppLeadProfile.collection.name,
        localField: 'phone',
        foreignField: 'phone',
        as: 'profile',
      },
    },
    {
      $addFields: {
        profile: { $arrayElemAt: ['$profile', 0] },
      },
    },
    {
      $sort: {
        leadScore: -1,
        'profile.lastInteractionAt': -1,
      },
    },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: safeLimit },
          {
            $project: {
              phone: 1,
              leadScore: 1,
              leadStage: 1,
              branchInterest: '$profile.branchInterest',
              collegeInterest: '$profile.collegeInterest',
              eventCount: { $ifNull: ['$profile.eventCount', 0] },
              lastInteractionAt: '$profile.lastInteractionAt',
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  return {
    total: result?.total?.[0]?.count || 0,
    page: safePage,
    limit: safeLimit,
    items: result?.items || [],
  };
}

async function getLeadStats() {
  const [stats] = await WhatsAppLeadScore.aggregate([
    {
      $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        coldLeads: {
          $sum: {
            $cond: [{ $eq: ['$leadStage', 'cold'] }, 1, 0],
          },
        },
        warmLeads: {
          $sum: {
            $cond: [{ $eq: ['$leadStage', 'warm'] }, 1, 0],
          },
        },
        hotLeads: {
          $sum: {
            $cond: [{ $eq: ['$leadStage', 'hot'] }, 1, 0],
          },
        },
        averageScore: { $avg: '$leadScore' },
      },
    },
    {
      $project: {
        _id: 0,
        totalLeads: 1,
        coldLeads: 1,
        warmLeads: 1,
        hotLeads: 1,
        averageScore: {
          $round: ['$averageScore', 1],
        },
      },
    },
  ]);

  return {
    totalLeads: stats?.totalLeads || 0,
    coldLeads: stats?.coldLeads || 0,
    warmLeads: stats?.warmLeads || 0,
    hotLeads: stats?.hotLeads || 0,
    averageScore: stats?.averageScore ?? 0,
  };
}

async function getHotLeads() {
  const rows = await WhatsAppLeadScore.aggregate([
    { $match: { leadStage: 'hot' } },
    { $sort: { leadScore: -1 } },
    { $limit: HOT_LEADS_LIMIT },
    {
      $lookup: {
        from: WhatsAppLeadProfile.collection.name,
        localField: 'phone',
        foreignField: 'phone',
        as: 'profile',
      },
    },
    {
      $addFields: {
        profile: { $arrayElemAt: ['$profile', 0] },
      },
    },
    {
      $project: {
        phone: 1,
        leadScore: 1,
        leadStage: 1,
        scoreReasons: 1,
        confidence: 1,
        lastScoredAt: 1,
        branchInterest: '$profile.branchInterest',
        collegeInterest: '$profile.collegeInterest',
        eventCount: { $ifNull: ['$profile.eventCount', 0] },
        lastInteractionAt: '$profile.lastInteractionAt',
      },
    },
  ]);

  return rows;
}

module.exports = {
  VALID_STAGES,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  RECENT_EVENTS_LIMIT,
  HOT_LEADS_LIMIT,
  normalizePhone10,
  parsePositiveInt,
  parseMinScore,
  parseStage,
  mapListItem,
  getLeadDetails,
  listLeads,
  getLeadStats,
  getHotLeads,
};
