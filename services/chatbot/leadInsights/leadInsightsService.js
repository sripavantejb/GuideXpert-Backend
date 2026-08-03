'use strict';

const FormSubmission = require('../../../models/FormSubmission');
const IitCounsellingSubmission = require('../../../models/IitCounsellingSubmission');
const WhatsAppLeadProfile = require('../../../models/WhatsAppLeadProfile');
const WhatsAppLeadScore = require('../../../models/WhatsAppLeadScore');
const WhatsAppLeadEvent = require('../../../models/WhatsAppLeadEvent');
const WhatsAppConversation = require('../../../models/WhatsAppConversation');
const chatbotAdmin = require('../chatbotAdminService');

const VALID_STAGES = new Set(['cold', 'warm', 'hot']);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const RECENT_EVENTS_LIMIT = 20;
const HOT_LEADS_LIMIT = 50;
const TRANSCRIPT_DEFAULT_LIMIT = 200;

const PROFILE_LIST_PROJECTION =
  'phone branchInterest collegeInterest exam languagePreference priceSensitive demoInterested handoffRequested assistantTypesUsed eventCount lastInteractionAt conversationId';
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

function parseAwaitingReply(value) {
  if (value == null || value === '') {
    return { awaitingReply: null };
  }
  const raw = String(value).trim().toLowerCase();
  if (raw === 'true' || raw === '1') return { awaitingReply: true };
  if (raw === 'false' || raw === '0') return { awaitingReply: false };
  return { error: 'Invalid awaitingReply. Expected true or false.' };
}

function computeNoReplyFields(conversation, now = new Date()) {
  if (!conversation) {
    return {
      awaitingReply: false,
      noReplyMs: null,
      noReplySince: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      conversationId: null,
    };
  }

  const lastInboundAt = conversation.lastInboundAt
    ? new Date(conversation.lastInboundAt)
    : null;
  const lastOutboundAt = conversation.lastOutboundAt
    ? new Date(conversation.lastOutboundAt)
    : null;

  const inboundMs = lastInboundAt && !Number.isNaN(lastInboundAt.getTime()) ? lastInboundAt.getTime() : null;
  const outboundMs =
    lastOutboundAt && !Number.isNaN(lastOutboundAt.getTime()) ? lastOutboundAt.getTime() : null;

  const awaitingReply = inboundMs != null && (outboundMs == null || inboundMs > outboundMs);
  const noReplyMs = awaitingReply ? Math.max(0, now.getTime() - inboundMs) : null;

  return {
    awaitingReply,
    noReplyMs,
    noReplySince: awaitingReply && lastInboundAt ? lastInboundAt.toISOString() : null,
    lastInboundAt: lastInboundAt ? lastInboundAt.toISOString() : null,
    lastOutboundAt: lastOutboundAt ? lastOutboundAt.toISOString() : null,
    conversationId: conversation._id ? String(conversation._id) : null,
  };
}

function mapListItem(scoreDoc = {}, profileDoc = {}, name = null, noReply = {}) {
  return {
    phone: scoreDoc.phone || profileDoc.phone || null,
    name: name || null,
    leadScore: scoreDoc.leadScore ?? null,
    leadStage: scoreDoc.leadStage ?? null,
    branchInterest: profileDoc.branchInterest ?? null,
    collegeInterest: profileDoc.collegeInterest ?? null,
    exam: profileDoc.exam ?? null,
    languagePreference: profileDoc.languagePreference ?? null,
    priceSensitive: Boolean(profileDoc.priceSensitive),
    demoInterested: Boolean(profileDoc.demoInterested),
    handoffRequested: Boolean(profileDoc.handoffRequested),
    eventCount: profileDoc.eventCount ?? 0,
    lastInteractionAt: profileDoc.lastInteractionAt ?? null,
    conversationId: noReply.conversationId || (profileDoc.conversationId ? String(profileDoc.conversationId) : null),
    awaitingReply: Boolean(noReply.awaitingReply),
    noReplyMs: noReply.noReplyMs ?? null,
    noReplySince: noReply.noReplySince ?? null,
    lastInboundAt: noReply.lastInboundAt ?? null,
    lastOutboundAt: noReply.lastOutboundAt ?? null,
  };
}

async function loadDisplayNamesByPhone(phones = []) {
  const phoneList = [...new Set(phones.map((phone) => String(phone || '').trim()).filter(Boolean))];
  const nameByPhone = new Map();
  if (!phoneList.length) {
    return nameByPhone;
  }

  const [gxRows, iitRows] = await Promise.all([
    FormSubmission.find({ phone: { $in: phoneList } })
      .select('phone fullName')
      .lean(),
    IitCounsellingSubmission.find({ phone: { $in: phoneList } })
      .select('phone fullName updatedAt')
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  for (const row of iitRows) {
    const fullName = String(row?.fullName || '').trim();
    if (fullName && row?.phone && !nameByPhone.has(row.phone)) {
      nameByPhone.set(row.phone, fullName);
    }
  }
  for (const row of gxRows) {
    const fullName = String(row?.fullName || '').trim();
    if (fullName && row?.phone && !nameByPhone.has(row.phone)) {
      nameByPhone.set(row.phone, fullName);
    }
  }

  return nameByPhone;
}

async function loadConversationsByPhone(phones = []) {
  const phoneList = [...new Set(phones.map((phone) => String(phone || '').trim()).filter(Boolean))];
  const byPhone = new Map();
  if (!phoneList.length) return byPhone;

  const rows = await WhatsAppConversation.find({ phone: { $in: phoneList } })
    .select('phone lastInboundAt lastOutboundAt messageCount status updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  for (const row of rows) {
    if (row?.phone && !byPhone.has(row.phone)) {
      byPhone.set(row.phone, row);
    }
  }
  return byPhone;
}

async function enrichLeadListItems(items = []) {
  const phones = items.map((item) => item.phone);
  const [nameByPhone, conversationByPhone] = await Promise.all([
    loadDisplayNamesByPhone(phones),
    loadConversationsByPhone(phones),
  ]);
  const now = new Date();

  return items.map((item) => {
    const noReply = computeNoReplyFields(conversationByPhone.get(item.phone), now);
    return {
      ...item,
      name: nameByPhone.get(item.phone) || item.name || null,
      ...noReply,
      conversationId:
        noReply.conversationId ||
        (item.conversationId ? String(item.conversationId) : null),
    };
  });
}

async function getLeadDetails(phone) {
  const phone10 = normalizePhone10(phone);
  if (!phone10) {
    return { error: 'Invalid phone. Expected 10 digits.' };
  }

  const [profile, score, recentEvents, nameByPhone, conversation] = await Promise.all([
    WhatsAppLeadProfile.findOne({ phone: phone10 }).select(PROFILE_LIST_PROJECTION).lean(),
    WhatsAppLeadScore.findOne({ phone: phone10 }).select(SCORE_LIST_PROJECTION).lean(),
    WhatsAppLeadEvent.find({ phone: phone10 })
      .select(EVENT_DETAIL_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(RECENT_EVENTS_LIMIT)
      .lean(),
    loadDisplayNamesByPhone([phone10]),
    WhatsAppConversation.findOne({ phone: phone10 }).sort({ updatedAt: -1 }).lean(),
  ]);

  const name = nameByPhone.get(phone10) || null;
  const noReply = computeNoReplyFields(conversation);

  return {
    name,
    profile: profile ? { ...profile, name } : null,
    score: score || null,
    recentEvents: recentEvents || [],
    conversationId:
      noReply.conversationId ||
      (profile?.conversationId ? String(profile.conversationId) : null) ||
      (score?.conversationId ? String(score.conversationId) : null),
    awaitingReply: noReply.awaitingReply,
    noReplyMs: noReply.noReplyMs,
    noReplySince: noReply.noReplySince,
    lastInboundAt: noReply.lastInboundAt,
    lastOutboundAt: noReply.lastOutboundAt,
  };
}

const LIST_PROJECT = {
  phone: 1,
  leadScore: 1,
  leadStage: 1,
  conversationId: 1,
  branchInterest: '$profile.branchInterest',
  collegeInterest: '$profile.collegeInterest',
  exam: '$profile.exam',
  languagePreference: '$profile.languagePreference',
  priceSensitive: { $ifNull: ['$profile.priceSensitive', false] },
  demoInterested: { $ifNull: ['$profile.demoInterested', false] },
  handoffRequested: { $ifNull: ['$profile.handoffRequested', false] },
  eventCount: { $ifNull: ['$profile.eventCount', 0] },
  lastInteractionAt: '$profile.lastInteractionAt',
};

async function listLeads({
  stage = null,
  minScore = null,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
  awaitingReply = null,
} = {}) {
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

  // When filtering by awaitingReply we must enrich first, then filter + paginate.
  if (awaitingReply != null) {
    const rows = await WhatsAppLeadScore.aggregate([
      { $match: match },
      {
        $lookup: {
          from: WhatsAppLeadProfile.collection.name,
          localField: 'phone',
          foreignField: 'phone',
          as: 'profile',
        },
      },
      { $addFields: { profile: { $arrayElemAt: ['$profile', 0] } } },
      { $sort: { leadScore: -1, 'profile.lastInteractionAt': -1 } },
      { $project: LIST_PROJECT },
    ]);

    let items = await enrichLeadListItems(rows);
    items = items.filter((row) => Boolean(row.awaitingReply) === awaitingReply);

    return {
      total: items.length,
      page: safePage,
      limit: safeLimit,
      items: items.slice(skip, skip + safeLimit),
    };
  }

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
    { $addFields: { profile: { $arrayElemAt: ['$profile', 0] } } },
    { $sort: { leadScore: -1, 'profile.lastInteractionAt': -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: safeLimit }, { $project: LIST_PROJECT }],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  return {
    total: result?.total?.[0]?.count || 0,
    page: safePage,
    limit: safeLimit,
    items: await enrichLeadListItems(result?.items || []),
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

  const phones = await WhatsAppLeadScore.find({}).select('phone').lean();
  const conversationByPhone = await loadConversationsByPhone(phones.map((p) => p.phone));
  const now = new Date();
  let awaitingReplyCount = 0;
  for (const row of phones) {
    const fields = computeNoReplyFields(conversationByPhone.get(row.phone), now);
    if (fields.awaitingReply) awaitingReplyCount += 1;
  }

  return {
    totalLeads: stats?.totalLeads || 0,
    coldLeads: stats?.coldLeads || 0,
    warmLeads: stats?.warmLeads || 0,
    hotLeads: stats?.hotLeads || 0,
    averageScore: stats?.averageScore ?? 0,
    awaitingReplyCount,
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
    { $addFields: { profile: { $arrayElemAt: ['$profile', 0] } } },
    { $project: { ...LIST_PROJECT, scoreReasons: 1, confidence: 1, lastScoredAt: 1 } },
  ]);

  return enrichLeadListItems(rows);
}

async function getLeadTranscript(phone, { limit = TRANSCRIPT_DEFAULT_LIMIT } = {}) {
  const phone10 = normalizePhone10(phone);
  if (!phone10) {
    return { error: 'Invalid phone. Expected 10 digits.' };
  }

  const [score, profile, conversation] = await Promise.all([
    WhatsAppLeadScore.findOne({ phone: phone10 }).select('conversationId').lean(),
    WhatsAppLeadProfile.findOne({ phone: phone10 }).select('conversationId').lean(),
    WhatsAppConversation.findOne({ phone: phone10 }).sort({ updatedAt: -1 }).lean(),
  ]);

  const conversationId =
    conversation?._id || score?.conversationId || profile?.conversationId || null;

  if (!conversationId) {
    return {
      conversation: null,
      messages: [],
      phone: phone10,
      message: 'No conversation found for this phone.',
    };
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || TRANSCRIPT_DEFAULT_LIMIT, 1), 200);
  const data = await chatbotAdmin.getConversationTranscript(conversationId, safeLimit);
  return {
    phone: phone10,
    conversation: data.conversation,
    messages: data.messages || [],
  };
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
  parseAwaitingReply,
  computeNoReplyFields,
  mapListItem,
  loadDisplayNamesByPhone,
  enrichLeadListItems,
  getLeadDetails,
  listLeads,
  getLeadStats,
  getHotLeads,
  getLeadTranscript,
};
