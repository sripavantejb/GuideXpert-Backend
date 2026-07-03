'use strict';

const {
  EXAM_AP,
  EXAM_TS,
  EXAM_TNEA,
  EXAM_KCET,
  EXAM_KEAM,
  EXAM_WBJEE,
  EXAM_JEE_MAIN,
  EXAM_JEE_ADV,
  EXAM_MHT,
  EXAM_OPTIONS,
  mapById,
  mapExamChoice,
  mapGenderChoice,
  mapRegionChoice,
} = require('../../../constants/whatsappCollegePredictor');
const {
  categoryOptionsForExam,
  admissionOptionsForExam,
  SLOT_EXAM,
  SLOT_RANK,
  SLOT_PERCENTILE,
  SLOT_ADMISSION_TYPE,
  SLOT_CATEGORY,
  SLOT_GENDER,
  SLOT_QUOTA,
  SLOT_REGION,
  getMissingSlots,
} = require('./collegePredictorSlots');
const { AP_REGION_OPTIONS } = require('./apTs');
const { WBJEE_QUOTA_OPTIONS } = require('./wbjee');

const EXAM_ALIAS_RULES = [
  { value: EXAM_AP, patterns: [/\bap\s*eamc?e?t\b/, /\bandhra\s*eamcet\b/, /\beamcet\s*ap\b/, /^ap$/] },
  { value: EXAM_TS, patterns: [/\bts\s*eamc?e?t\b/, /\bts\s*eams?t\b/, /\bts\s*emcet\b/, /\btseamcet\b/i, /\btsemcet\b/i, /\btelangana\s*eamcet\b/, /\beamcet\s*telangana\b/, /^ts$/] },
  { value: EXAM_TNEA, patterns: [/\btnea\b/, /\btamil\s*nadu\s*engineering\b/] },
  { value: EXAM_KCET, patterns: [/\bkcet{1,2}\b/, /\bkarnataka\s*cet\b/] },
  { value: EXAM_KEAM, patterns: [/\bkeam\b/, /\bkerala\s*engineering\b/] },
  { value: EXAM_WBJEE, patterns: [/\bwbj+e{1,4}\b/, /\bwest\s*bengal\s*jee\b/] },
  {
    value: EXAM_JEE_MAIN,
    patterns: [/\bjee\s*main?s?\b/, /\bmain\s*jee\b/, /\bjeemains\b/, /^jee$/],
  },
  {
    value: EXAM_JEE_ADV,
    patterns: [/\bjee\s*adv(?:anced)?\b/, /\badvanced\s*jee\b/, /\bjeeadv\b/],
  },
  { value: EXAM_MHT, patterns: [/\bmht\s*cet{1,2}\b/, /\bmhtcet{1,2}\b/, /\bmaharashtra\s*cet\b/] },
];

function normalizeInput(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseMenuDigit(text) {
  const t = String(text || '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return Number.isInteger(n) ? n : null;
}

function parsePositiveIntRank(text) {
  const raw = String(text || '').trim();
  const normalized = raw.replace(/,/g, '');

  const kMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const n = Math.round(Number(kMatch[1]) * 1000);
    if (Number.isFinite(n) && n >= 1) return n;
  }

  const rankMatch =
    normalized.match(/\brank\s*(?:is|:|=|-)?\s*(\d{1,9})\b/i) ||
    normalized.match(/\b(\d{1,9})\s*rank\b/i) ||
    normalized.match(/\bAIR\s*[#:]?\s*(\d{1,9})\b/i) ||
    normalized.match(/\b(?:got|scored|secured)\s+(\d{1,9})\b/i) ||
    normalized.match(/\b(\d{3,9})\s+in\b/i);
  if (rankMatch) {
    const n = parseInt(rankMatch[1], 10);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }
  if (/^\d+$/.test(normalized)) {
    const n = parseInt(normalized, 10);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return null;
}

function parsePercentileValue(text) {
  const raw = String(text || '').trim();
  const pctMatch =
    raw.match(/\bpercentile\s*[:\-]?\s*(\d+(?:\.\d+)?)\b/i) ||
    raw.match(/\b(\d+(?:\.\d+)?)\s*percentile\b/i) ||
    raw.match(/\b(\d+(?:\.\d+)?)\s*%\b/) ||
    raw.match(/\b(?:got|scored|secured)\s+(\d+(?:\.\d+)?)\s+(?:percentile|in)\b/i) ||
    raw.match(/\bmy\s+percentile\s+is\s+(\d+(?:\.\d+)?)\b/i);
  const candidate = pctMatch ? pctMatch[1] : raw.replace(/%$/, '').trim();
  if (!/^\d+(\.\d+)?$/.test(candidate)) return null;
  const n = Number(candidate);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return n;
}

function parseExamFromText(text, focusSlot) {
  const t = normalizeInput(text);
  if (!t) return null;

  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_EXAM) {
    const mapped = mapExamChoice(digit);
    if (mapped) return mapped;
  }

  for (const rule of EXAM_ALIAS_RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      return rule.value;
    }
  }

  for (const opt of EXAM_OPTIONS) {
    const label = normalizeInput(opt.label);
    if (t === label || t.includes(label)) return opt.value;
  }

  if (/\beamcet\b/.test(t)) {
    if (/\b(ts|telangana)\b/.test(t)) return EXAM_TS;
    if (/\b(ap|andhra)\b/.test(t)) return EXAM_AP;
  }

  return null;
}

function parseGenderFromText(text, focusSlot) {
  const t = normalizeInput(text);
  if (!t) return null;

  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_GENDER) {
    return mapGenderChoice(digit);
  }

  const compact = t.replace(/\s+/g, '');
  if (/\b(male|female)\b/.test(t) && /\bmale\b/.test(t) && /\bfemale\b/.test(t)) {
    return null;
  }
  if (/^(female|femlae|fmale|femae|feamle|girl|f)$/.test(compact)) return 'female';
  if (/^(male|mlae|malr|mle|boy|m)$/.test(compact)) return 'male';
  if (/\b(female|girl|f)\b/.test(t)) return 'female';
  if (/\b(male|boy|m)\b/.test(t) && !/\bfemale\b/.test(t)) return 'male';
  return null;
}

function normalizeCategoryToken(token) {
  return String(token || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
}

function matchCategoryOption(text, options, focusSlot) {
  const t = normalizeInput(text);
  if (!t || !options.length) return null;

  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_CATEGORY) {
    const byId = mapById(options, digit);
    if (byId) return byId;
  }

  const normalized = normalizeCategoryToken(t);
  for (const opt of options) {
    const labelNorm = normalizeCategoryToken(opt.label);
    const valueNorm = normalizeCategoryToken(opt.value || '');
    if (normalized === labelNorm || (valueNorm && normalized === valueNorm)) return opt;
    if (labelNorm && normalized.includes(labelNorm)) return opt;
    const labelPrefix = normalizeCategoryToken(String(opt.label).split('(')[0]);
    if (labelPrefix && (normalized === labelPrefix || normalized.startsWith(labelPrefix))) return opt;
  }

  const aliasMap = {
    'BC-B': 'BC-B',
    BCB: 'BC-B',
    'BC-A': 'BC-A',
    BCA: 'BC-A',
    'BC-C': 'BC-C',
    BCC: 'BC-C',
    'BC-D': 'BC-D',
    BCD: 'BC-D',
    'BC-E': 'BC-E',
    BCE: 'BC-E',
    'OBC-NCL': 'OBC-NCL',
    OBCNCL: 'OBC-NCL',
    OBC: 'OBC-NCL',
    OPENPWD: 'OPEN (PwD)',
    'OPEN(PWD)': 'OPEN (PwD)',
    GENERAL: 'OC',
    GEN: 'OC',
    OPEN: 'OC',
  };
  const alias = aliasMap[normalized];
  if (alias) {
    return options.find((o) => normalizeCategoryToken(o.label).includes(normalizeCategoryToken(alias))) || null;
  }

  if (/\bobc\b/.test(t) && !/ncl/.test(t)) {
    const obc = options.find((o) => o.label === 'OBC-NCL' || o.value === 'OBC-NCL');
    if (obc) return obc;
  }

  if (/\bbc[\s-]?b\b/.test(t)) return options.find((o) => o.label === 'BC-B') || null;
  if (/\bbc[\s-]?a\b/.test(t)) return options.find((o) => o.label === 'BC-A') || null;
  if (/\bbc[\s-]?c\b/.test(t)) return options.find((o) => o.label === 'BC-C') || null;
  if (/\bbc[\s-]?d\b/.test(t)) return options.find((o) => o.label === 'BC-D') || null;
  if (/\bbc[\s-]?e\b/.test(t)) return options.find((o) => o.label === 'BC-E') || null;

  return null;
}

function parseCategoryFromText(text, ctx, focusSlot) {
  const options = categoryOptionsForExam(ctx);
  const matched = matchCategoryOption(text, options, focusSlot);
  if (!matched) return null;
  return {
    categoryLabel: matched.label,
    categoryN: matched.id,
    baseCategory: matched.value || matched.label,
  };
}

function parseAdmissionFromText(text, ctx, focusSlot) {
  const options = admissionOptionsForExam(ctx.exam);
  if (!options.length) return null;

  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_ADMISSION_TYPE) {
    const mapped = mapById(options, digit);
    if (mapped) {
      return {
        admissionType: mapped.value,
        admission_category_name_enum: mapped.apiValue || mapped.value,
      };
    }
  }

  const t = normalizeInput(text);
  for (const opt of options) {
    if (t === normalizeInput(opt.label) || t.includes(normalizeInput(opt.label))) {
      return {
        admissionType: opt.value,
        admission_category_name_enum: opt.apiValue || opt.value,
      };
    }
  }
  if (/\bhk\b/.test(t) || /hyderabad.karnataka/i.test(text)) {
    const hk = options.find((o) => o.value === 'HK');
    if (hk) return { admissionType: hk.value, admission_category_name_enum: hk.apiValue || hk.value };
  }
  if (/state\s*level|gopens|gobcs|gsc|gsebc|tfws/i.test(text) && ctx.exam === EXAM_MHT) {
    const sl = options.find((o) => o.apiValue === 'SL' || o.value === 'STATE_LEVEL');
    if (sl) {
      return {
        admissionType: sl.value,
        admission_category_name_enum: sl.apiValue || sl.value,
      };
    }
  }
  return null;
}

function parseQuotaFromText(text, focusSlot) {
  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_QUOTA) {
    const mapped = mapById(WBJEE_QUOTA_OPTIONS, digit);
    if (mapped) return { quota: mapped.value };
  }
  const t = normalizeInput(text);
  if (/all\s*india/.test(t)) return { quota: 'all_india' };
  if (/home\s*state|west\s*bengal/.test(t)) return { quota: 'home_state_wb' };
  if ((t === 'ai' || t === 'all india') && !/branch|artificial/i.test(text)) {
    return { quota: 'all_india' };
  }
  return null;
}

function parseRegionFromText(text, focusSlot) {
  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_REGION) {
    const region = mapRegionChoice(digit);
    if (region) return { admission_category_name_enum: region };
  }
  const t = normalizeInput(text);
  if (/\bau\b/.test(t) || /andhra\s*university/.test(t)) return { admission_category_name_enum: 'AU' };
  if (/\bsvu\b/.test(t) || /sri\s*venkateswara/.test(t)) return { admission_category_name_enum: 'SVU' };
  return null;
}

/**
 * Extract any slots present in a user message.
 * @param {string} text
 * @param {object} ctx
 * @returns {object} partial slot updates
 */
function extractSlotsFromMessage(text, ctx = {}) {
  const missing = getMissingSlots(ctx);
  const focus = missing[0] || null;
  const updates = {};

  const menuDigit = parseMenuDigit(text);
  const exam = parseExamFromText(text, focus);
  if (exam) updates.exam = exam;

  const examForRank = updates.exam || ctx.exam;
  const percentile = parsePercentileValue(text);
  if (
    percentile != null &&
    !(focus === SLOT_EXAM && menuDigit != null) &&
    (examForRank === EXAM_MHT ||
      focus === SLOT_PERCENTILE ||
      /\bpercentile\b/i.test(text) ||
      /\b\d+(?:\.\d+)?\s*%/.test(text) ||
      /\bmy\s+percentile\s+is\b/i.test(text))
  ) {
    updates.percentile = percentile;
  }

  if (examForRank !== EXAM_MHT && !updates.percentile) {
    const rank = parsePositiveIntRank(text);
    if (rank != null) {
      const digitOnly = menuDigit != null && String(text || '').trim() === String(menuDigit);
      const allowRank =
        focus === SLOT_RANK ||
        /\brank\b/i.test(text) ||
        /\bAIR\b/i.test(text) ||
        /\b(?:got|scored|secured)\s+\d/i.test(text) ||
        /\b\d{3,7}\s+in\b/i.test(text) ||
        (digitOnly && rank >= 100 && focus !== SLOT_EXAM && focus !== SLOT_CATEGORY);
      if (allowRank) {
        updates.rank = rank;
      }
    }
  }

  const examCtx = { ...ctx, ...updates };
  if (examCtx.exam) {
    const admission = parseAdmissionFromText(
      text,
      examCtx,
      focus === SLOT_ADMISSION_TYPE ? SLOT_ADMISSION_TYPE : null
    );
    if (admission) Object.assign(updates, admission);

    const category = parseCategoryFromText(
      text,
      { ...examCtx, ...updates },
      focus === SLOT_CATEGORY ? SLOT_CATEGORY : null
    );
    if (category) Object.assign(updates, category);
    else if (
      focus !== SLOT_CATEGORY &&
      examCtx.exam &&
      /\b(bc[\s-]?[a-e]|sc|st|ews|oc|obc|general|gen|open|gopens|gobc|gsc)\b/i.test(text)
    ) {
      const semanticCategory = parseCategoryFromText(
        text,
        { ...examCtx, ...updates },
        SLOT_CATEGORY
      );
      if (semanticCategory) Object.assign(updates, semanticCategory);
    }

    const gender = parseGenderFromText(text, focus === SLOT_GENDER ? SLOT_GENDER : null);
    if (gender) {
      updates.gender = gender;
    } else if (focus !== SLOT_GENDER && /\b(male|female|boy|girl)\b/i.test(text)) {
      const semanticGender = parseGenderFromText(text, SLOT_GENDER);
      if (semanticGender) updates.gender = semanticGender;
    }

    const quota = parseQuotaFromText(text, focus === SLOT_QUOTA ? SLOT_QUOTA : null);
    if (quota) Object.assign(updates, quota);

    if (examCtx.exam === EXAM_AP) {
      const region = parseRegionFromText(text, focus === SLOT_REGION ? SLOT_REGION : null);
      if (region) Object.assign(updates, region);
    }
  }

  return updates;
}

module.exports = {
  extractSlotsFromMessage,
  parseExamFromText,
  parsePositiveIntRank,
  parsePercentileValue,
  parseGenderFromText,
  matchCategoryOption,
};
