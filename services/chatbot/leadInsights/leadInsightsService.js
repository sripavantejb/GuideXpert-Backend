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

/** IST offset from UTC (no DST). Used for calendar day boundaries. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function parseActivityDate(value) {
  if (value == null || value === '') {
    return { activityDate: null };
  }
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { error: 'Invalid activityDate. Expected YYYY-MM-DD.' };
  }
  const [y, m, d] = raw.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { error: 'Invalid activityDate. Expected YYYY-MM-DD.' };
  }
  return { activityDate: raw };
}

function getIstDayRange(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
  const endMs = Date.UTC(y, m - 1, d + 1) - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(endMs) };
}

function getIstMonthRange(year, month) {
  const startMs = Date.UTC(year, month - 1, 1) - IST_OFFSET_MS;
  const endMs = Date.UTC(year, month, 1) - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(endMs) };
}

function toIstDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function conversationActivityAt(conversation = {}) {
  const inbound = conversation.lastInboundAt ? new Date(conversation.lastInboundAt) : null;
  if (inbound && !Number.isNaN(inbound.getTime())) return inbound;
  const updated = conversation.updatedAt ? new Date(conversation.updatedAt) : null;
  if (updated && !Number.isNaN(updated.getTime())) return updated;
  return null;
}

function getCurrentIstYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

function activityAtInIstDay(activityAt, activityDate) {
  if (!activityAt || !activityDate) return false;
  const { start, end } = getIstDayRange(activityDate);
  const ms = activityAt.getTime();
  return ms >= start.getTime() && ms < end.getTime();
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

const CONVERSATION_ACTIVITY_MATCH = {
  $or: [
    { messageCount: { $gt: 0 } },
    { lastInboundAt: { $ne: null } },
    { lastOutboundAt: { $ne: null } },
  ],
};

function mapListItem(scoreDoc = {}, profileDoc = {}, name = null, noReply = {}, phone = null) {
  return {
    phone: phone || scoreDoc.phone || profileDoc.phone || null,
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

function mapAggregatedConversationRow(row = {}) {
  const scoreDoc = row.score || {};
  const profileDoc = row.profile || {};
  const conversation = row.conversation || {};
  const phone = row.phone || row._id || null;
  const noReply = computeNoReplyFields(conversation);
  const activityAt = conversationActivityAt(conversation);
  return {
    ...mapListItem(scoreDoc, profileDoc, null, noReply, phone),
    activityAt: activityAt ? activityAt.toISOString() : null,
  };
}

async function buildLeadItemForPhone(phone10, now = new Date()) {
  const [conversation, score, profile, nameByPhone] = await Promise.all([
    WhatsAppConversation.findOne({ phone: phone10, ...CONVERSATION_ACTIVITY_MATCH })
      .sort({ updatedAt: -1 })
      .select('phone lastInboundAt lastOutboundAt messageCount status updatedAt')
      .lean(),
    WhatsAppLeadScore.findOne({ phone: phone10 }).select(SCORE_LIST_PROJECTION).lean(),
    WhatsAppLeadProfile.findOne({ phone: phone10 }).select(PROFILE_LIST_PROJECTION).lean(),
    loadDisplayNamesByPhone([phone10]),
  ]);

  if (!conversation) {
    return null;
  }

  const noReply = computeNoReplyFields(conversation, now);
  const activityAt = conversationActivityAt(conversation);
  return {
    ...mapListItem(score || {}, profile || {}, nameByPhone.get(phone10) || null, noReply, phone10),
    ...noReply,
    activityAt: activityAt ? activityAt.toISOString() : null,
    conversationId:
      noReply.conversationId ||
      (profile?.conversationId ? String(profile.conversationId) : null) ||
      (score?.conversationId ? String(score.conversationId) : null),
  };
}

function passesScoreFilters(item, { stage = null, minScore = null } = {}) {
  if (!stage && minScore == null) {
    return true;
  }
  if (item.leadScore == null || item.leadStage == null) {
    return false;
  }
  if (stage && item.leadStage !== stage) {
    return false;
  }
  if (minScore != null && (item.leadScore ?? 0) < minScore) {
    return false;
  }
  return true;
}

function sortListItems(items = []) {
  return [...items].sort((a, b) => {
    const aInbound = a.lastInboundAt ? new Date(a.lastInboundAt).getTime() : 0;
    const bInbound = b.lastInboundAt ? new Date(b.lastInboundAt).getTime() : 0;
    if (bInbound !== aInbound) {
      return bInbound - aInbound;
    }
    return (b.leadScore ?? -1) - (a.leadScore ?? -1);
  });
}

async function loadConversationLeadRows() {
  const rows = await WhatsAppConversation.aggregate([
    { $match: CONVERSATION_ACTIVITY_MATCH },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: '$phone',
        conversation: { $first: '$$ROOT' },
        phone: { $first: '$phone' },
      },
    },
    {
      $lookup: {
        from: WhatsAppLeadScore.collection.name,
        localField: 'phone',
        foreignField: 'phone',
        as: 'scoreRows',
      },
    },
    {
      $lookup: {
        from: WhatsAppLeadProfile.collection.name,
        localField: 'phone',
        foreignField: 'phone',
        as: 'profileRows',
      },
    },
    {
      $addFields: {
        score: { $arrayElemAt: ['$scoreRows', 0] },
        profile: { $arrayElemAt: ['$profileRows', 0] },
      },
    },
    {
      $project: {
        phone: 1,
        conversation: 1,
        score: {
          phone: 1,
          leadScore: 1,
          leadStage: 1,
          scoreReasons: 1,
          confidence: 1,
          lastScoredAt: 1,
          conversationId: 1,
        },
        profile: {
          phone: 1,
          branchInterest: 1,
          collegeInterest: 1,
          exam: 1,
          languagePreference: 1,
          priceSensitive: 1,
          demoInterested: 1,
          handoffRequested: 1,
          eventCount: 1,
          lastInteractionAt: 1,
          conversationId: 1,
        },
      },
    },
  ]);

  const phones = rows.map((row) => row.phone).filter(Boolean);
  const nameByPhone = await loadDisplayNamesByPhone(phones);

  return rows.map((row) => {
    const item = mapAggregatedConversationRow(row);
    return {
      ...item,
      name: nameByPhone.get(item.phone) || item.name || null,
      conversationId:
        item.conversationId ||
        (row.conversation?._id ? String(row.conversation._id) : null),
    };
  });
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

async function listLeads({
  stage = null,
  minScore = null,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
  awaitingReply = null,
  phone = null,
  activityDate = null,
} = {}) {
  const safePage = parsePositiveInt(page, DEFAULT_PAGE);
  const safeLimit = parsePositiveInt(limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (safePage - 1) * safeLimit;

  const phone10 = normalizePhone10(phone);
  if (phone != null && phone !== '') {
    if (!phone10) {
      return { error: 'Invalid phone. Expected 10 digits.' };
    }
    const item = await buildLeadItemForPhone(phone10);
    let items = item ? [item] : [];
    if (activityDate) {
      items = items.filter((row) => {
        const at = row.activityAt ? new Date(row.activityAt) : null;
        return activityAtInIstDay(at, activityDate);
      });
    }
    return {
      total: items.length,
      page: 1,
      limit: safeLimit,
      items,
    };
  }

  let items = sortListItems(await loadConversationLeadRows());
  items = items.filter((row) => passesScoreFilters(row, { stage, minScore }));

  if (awaitingReply != null) {
    items = items.filter((row) => Boolean(row.awaitingReply) === awaitingReply);
  }

  if (activityDate) {
    items = items.filter((row) => {
      const at = row.activityAt ? new Date(row.activityAt) : null;
      return activityAtInIstDay(at, activityDate);
    });
  }

  return {
    total: items.length,
    page: safePage,
    limit: safeLimit,
    items: items.slice(skip, skip + safeLimit),
  };
}

async function getActivityCalendar({ year, month } = {}) {
  const current = getCurrentIstYearMonth();
  const safeYear = parsePositiveInt(year, current.year, 2100);
  const parsedMonth = parseInt(month, 10);
  const safeMonth =
    Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : current.month;

  if (year != null && year !== '' && (!Number.isFinite(Number(year)) || Number(year) < 2000)) {
    return { error: 'Invalid year.' };
  }
  if (month != null && month !== '' && (!Number.isFinite(parsedMonth) || parsedMonth < 1 || parsedMonth > 12)) {
    return { error: 'Invalid month. Expected 1-12.' };
  }

  const { start, end } = getIstMonthRange(safeYear, safeMonth);

  const rows = await WhatsAppConversation.aggregate([
    { $match: CONVERSATION_ACTIVITY_MATCH },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: '$phone',
        lastInboundAt: { $first: '$lastInboundAt' },
        updatedAt: { $first: '$updatedAt' },
      },
    },
    {
      $addFields: {
        activityAt: { $ifNull: ['$lastInboundAt', '$updatedAt'] },
      },
    },
    {
      $match: {
        activityAt: { $gte: start, $lt: end },
      },
    },
    {
      $project: {
        _id: 0,
        phone: '$_id',
        activityAt: 1,
      },
    },
  ]);

  const counts = new Map();
  for (const row of rows) {
    const key = toIstDateKey(row.activityAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const days = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    year: safeYear,
    month: safeMonth,
    days,
  };
}

async function getLeadStats() {
  const [scoreStats, conversationCount, scoredPhoneCount] = await Promise.all([
    WhatsAppLeadScore.aggregate([
      {
        $group: {
          _id: null,
          scoredLeads: { $sum: 1 },
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
          scoredLeads: 1,
          coldLeads: 1,
          warmLeads: 1,
          hotLeads: 1,
          averageScore: {
            $round: ['$averageScore', 1],
          },
        },
      },
    ]),
    WhatsAppConversation.aggregate([
      { $match: CONVERSATION_ACTIVITY_MATCH },
      { $group: { _id: '$phone' } },
      { $count: 'count' },
    ]),
    WhatsAppLeadScore.countDocuments({}),
  ]);

  const stats = scoreStats?.[0] || {};
  const totalLeads = conversationCount?.[0]?.count || 0;
  const scoredLeads = stats.scoredLeads || scoredPhoneCount || 0;
  const unscoredLeads = Math.max(0, totalLeads - scoredLeads);

  const conversationRows = await WhatsAppConversation.find(CONVERSATION_ACTIVITY_MATCH)
    .select('phone lastInboundAt lastOutboundAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();
  const conversationByPhone = new Map();
  for (const row of conversationRows) {
    if (row?.phone && !conversationByPhone.has(row.phone)) {
      conversationByPhone.set(row.phone, row);
    }
  }

  const now = new Date();
  let awaitingReplyCount = 0;
  for (const conversation of conversationByPhone.values()) {
    const fields = computeNoReplyFields(conversation, now);
    if (fields.awaitingReply) awaitingReplyCount += 1;
  }

  return {
    totalLeads,
    scoredLeads,
    unscoredLeads,
    coldLeads: stats.coldLeads || 0,
    warmLeads: stats.warmLeads || 0,
    hotLeads: stats.hotLeads || 0,
    averageScore: stats.averageScore ?? 0,
    awaitingReplyCount,
  };
}

async function getHotLeads() {
  const items = sortListItems(await loadConversationLeadRows()).filter(
    (row) => row.leadStage === 'hot'
  );
  return items.slice(0, HOT_LEADS_LIMIT);
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
  parseActivityDate,
  getIstDayRange,
  getIstMonthRange,
  toIstDateKey,
  conversationActivityAt,
  activityAtInIstDay,
  getCurrentIstYearMonth,
  computeNoReplyFields,
  mapListItem,
  mapAggregatedConversationRow,
  buildLeadItemForPhone,
  passesScoreFilters,
  sortListItems,
  loadConversationLeadRows,
  loadDisplayNamesByPhone,
  enrichLeadListItems,
  getLeadDetails,
  listLeads,
  getLeadStats,
  getActivityCalendar,
  getHotLeads,
  getLeadTranscript,
};
