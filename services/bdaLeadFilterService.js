const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { BDA_LANGUAGES } = require('../constants/bdaLanguage');
const { getISTDayRangeFromString } = require('../utils/dateHelpers');
const { IIT_SUB_DEDUP_PHONE_ADD_FIELDS } = require('../utils/iitCounsellingLeadDto');

let IitMeetAttendance;
let IitMeetHindiAttendance;
try {
  IitMeetAttendance = require('../models/IitMeetAttendance');
  IitMeetHindiAttendance = require('../models/IitMeetHindiAttendance');
} catch {
  IitMeetAttendance = null;
  IitMeetHindiAttendance = null;
}

const UNASSIGNED_MATCH = {
  submissionType: 'iitCounselling',
  $or: [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }],
};

function normalizePhoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function parseBdaLeadFilterQuery(query = {}) {
  const meetVariant = typeof query.meetVariant === 'string' ? query.meetVariant.trim() : '';
  const meetFrom = typeof query.meetFrom === 'string' ? query.meetFrom.trim() : '';
  const meetTo = typeof query.meetTo === 'string' ? query.meetTo.trim() : '';
  const meetPresence = typeof query.meetPresence === 'string' ? query.meetPresence.trim() : '';
  const preferredLanguage =
    typeof query.preferredLanguage === 'string' ? query.preferredLanguage.trim() : '';
  const slotDate = typeof query.slotDate === 'string' ? query.slotDate.trim() : '';
  const applicationStatus =
    typeof query.applicationStatus === 'string' ? query.applicationStatus.trim() : '';
  let hasPreferredLanguage = null;
  if (query.hasPreferredLanguage === 'true' || query.hasPreferredLanguage === '1') {
    hasPreferredLanguage = true;
  } else if (query.hasPreferredLanguage === 'false' || query.hasPreferredLanguage === '0') {
    hasPreferredLanguage = false;
  }
  const q = typeof query.q === 'string' ? query.q.trim() : '';

  return {
    meetVariant: ['english', 'hindi', 'either'].includes(meetVariant) ? meetVariant : '',
    meetFrom,
    meetTo,
    meetPresence: ['attended', 'not_attended'].includes(meetPresence) ? meetPresence : '',
    preferredLanguage: BDA_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : '',
    slotDate: /^\d{4}-\d{2}-\d{2}$/.test(slotDate) ? slotDate : '',
    applicationStatus: ['completed', 'in_progress'].includes(applicationStatus)
      ? applicationStatus
      : '',
    hasPreferredLanguage,
    q,
  };
}

function hasMeetFilter(parsed) {
  return Boolean(
    parsed.meetVariant ||
      parsed.meetFrom ||
      parsed.meetTo ||
      parsed.meetPresence
  );
}

async function fetchMeetAttendancePhoneKeys(parsed) {
  if (!hasMeetFilter(parsed)) return null;

  const models = [];
  if (!parsed.meetVariant || parsed.meetVariant === 'english' || parsed.meetVariant === 'either') {
    if (IitMeetAttendance) models.push({ model: IitMeetAttendance, label: 'english' });
  }
  if (!parsed.meetVariant || parsed.meetVariant === 'hindi' || parsed.meetVariant === 'either') {
    if (IitMeetHindiAttendance) models.push({ model: IitMeetHindiAttendance, label: 'hindi' });
  }

  if (models.length === 0) return new Set();

  let range = null;
  if (parsed.meetFrom) {
    const fromR = getISTDayRangeFromString(parsed.meetFrom);
    const toR = parsed.meetTo
      ? getISTDayRangeFromString(parsed.meetTo)
      : fromR;
    if (fromR && toR) {
      range = { $gte: fromR.start, $lt: toR.end };
    }
  }

  const phones = new Set();
  for (const { model } of models) {
    const match = {};
    if (range) match.timestamp = range;
    const rows = await model.aggregate([
      { $match: match },
      { $group: { _id: '$mobileNumber' } },
    ]);
    for (const row of rows) {
      const key = normalizePhoneKey(row._id);
      if (key) phones.add(key);
    }
  }
  return phones;
}

function buildBaseLeadMatch(parsed, { unassignedOnly = true, language = null } = {}) {
  const filter = { submissionType: 'iitCounselling' };

  if (unassignedOnly) {
    filter.$or = [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }];
  }

  const lang = language || parsed.preferredLanguage;
  if (BDA_LANGUAGES.includes(lang)) {
    filter['iitCounselling.section2Data.preferredLanguage'] = lang;
  } else if (parsed.hasPreferredLanguage === true) {
    filter['iitCounselling.section2Data.preferredLanguage'] = { $in: BDA_LANGUAGES };
  } else if (parsed.hasPreferredLanguage === false) {
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { 'iitCounselling.section2Data.preferredLanguage': { $exists: false } },
        { 'iitCounselling.section2Data.preferredLanguage': null },
        { 'iitCounselling.section2Data.preferredLanguage': '' },
        { 'iitCounselling.section2Data.preferredLanguage': { $nin: BDA_LANGUAGES } },
      ],
    });
  }

  if (parsed.applicationStatus === 'completed') {
    filter.isCompleted = true;
  } else if (parsed.applicationStatus === 'in_progress') {
    filter.isCompleted = { $ne: true };
  }

  if (parsed.slotDate) {
    const dayRange = getISTDayRangeFromString(parsed.slotDate);
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { 'iitCounselling.section1Data.slotBookingDate': parsed.slotDate },
        ...(dayRange
          ? [
              {
                counsellingSlotInstantUtc: {
                  $gte: dayRange.start,
                  $lt: dayRange.end,
                },
              },
            ]
          : []),
      ],
    });
  }

  if (parsed.q) {
    const escaped = parsed.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { fullName: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped } },
      ],
    });
  }

  return filter;
}

async function buildLeadMatchWithMeet(parsed, options = {}) {
  const base = buildBaseLeadMatch(parsed, options);
  const meetPhones = await fetchMeetAttendancePhoneKeys(parsed);

  if (meetPhones === null) return { match: base, meetPhones: null };

  if (parsed.meetPresence === 'attended') {
    if (meetPhones.size === 0) {
      return { match: { _id: { $in: [] } }, meetPhones };
    }
    const clause = buildPhoneMeetClause(meetPhones);
    base.$and = base.$and || [];
    base.$and.push(clause);
  } else if (parsed.meetPresence === 'not_attended') {
    if (meetPhones.size > 0) {
      const clause = buildPhoneMeetClause(meetPhones, true);
      if (clause) {
        base.$and = base.$and || [];
        base.$and.push(clause);
      }
    }
  } else if (hasMeetFilter(parsed)) {
    if (meetPhones.size === 0) {
      return { match: { _id: { $in: [] } }, meetPhones };
    }
    const clause = buildPhoneMeetClause(meetPhones);
    base.$and = base.$and || [];
    base.$and.push(clause);
  }

  return { match: base, meetPhones };
}

function buildPhoneMeetClause(meetPhones, negate = false) {
  const keys = [...meetPhones].filter(Boolean);
  if (keys.length === 0) {
    return negate ? null : { _id: { $in: [] } };
  }
  const orClauses = keys.map((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { phone: { $regex: `${escaped}$` } };
  });
  if (negate) {
    return { $nor: orClauses };
  }
  return { $or: orClauses };
}

async function aggregateDedupedLeads({ match, page = 1, limit = 25 }) {
  const skip = (page - 1) * limit;
  const pipeline = [
    { $match: match },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { phoneKey: 0, _demoSortKey: 0 } },
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    },
  ];

  const aggOut = await IitCounsellingSubmission.aggregate(pipeline);
  const facet = Array.isArray(aggOut) && aggOut[0] ? aggOut[0] : { data: [], meta: [] };
  return {
    rows: facet.data || [],
    total: facet.meta?.[0]?.total ?? 0,
  };
}

async function fetchDedupedUnassignedLeadIds(language, filterQuery = {}) {
  const parsed = parseBdaLeadFilterQuery(filterQuery);
  const { match } = await buildLeadMatchWithMeet(parsed, { unassignedOnly: true, language });
  const pipeline = [
    { $match: match },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { _id: 1 } },
  ];
  const rows = await IitCounsellingSubmission.aggregate(pipeline);
  return rows.map((r) => r._id).filter(Boolean);
}

async function getMeetFlagsForPhones(phones) {
  const keys = [...new Set(phones.map(normalizePhoneKey).filter(Boolean))];
  const flags = new Map(keys.map((k) => [k, { meetEnglish: false, meetHindi: false }]));
  if (keys.length === 0) return flags;

  const addFromModel = async (Model, field) => {
    if (!Model) return;
    const rows = await Model.aggregate([
      { $match: { mobileNumber: { $in: keys } } },
      { $group: { _id: '$mobileNumber' } },
    ]);
    for (const row of rows) {
      const k = normalizePhoneKey(row._id);
      if (!k || !flags.has(k)) continue;
      flags.get(k)[field] = true;
    }
  };

  await Promise.all([
    addFromModel(IitMeetAttendance, 'meetEnglish'),
    addFromModel(IitMeetHindiAttendance, 'meetHindi'),
  ]);
  return flags;
}

function enrichDtoWithMeetFlags(dto, meetFlags) {
  const key = normalizePhoneKey(dto.phone);
  const f = meetFlags.get(key) || { meetEnglish: false, meetHindi: false };
  return {
    ...dto,
    slotBookingDate: dto.section1Data?.slotBookingDate || '',
    meetEnglish: f.meetEnglish,
    meetHindi: f.meetHindi,
  };
}

module.exports = {
  parseBdaLeadFilterQuery,
  hasMeetFilter,
  buildBaseLeadMatch,
  buildLeadMatchWithMeet,
  aggregateDedupedLeads,
  fetchDedupedUnassignedLeadIds,
  getMeetFlagsForPhones,
  enrichDtoWithMeetFlags,
  normalizePhoneKey,
  UNASSIGNED_MATCH,
};
