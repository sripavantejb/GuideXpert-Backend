'use strict';

/**
 * Slot extractor for college predictor.
 *
 * All entity matching now goes through the shared EntityNormalizer, which
 * handles natural language, multilingual input, fuzzy casing/separators, and
 * full sentence prefixes without number-based menus.
 *
 * Number-only inputs are still accepted for backward compatibility (a "1" in
 * the right context maps to an option) but are NO LONGER required.
 */

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

// Load entity definitions (side-effect: registers all entity types)
require('../entityNormalization/entityDefinitions');

const {
  normalizeEntityValue,
  normalizeEntity,
} = require('../entityNormalization/entityNormalizer');

const { AP_REGION_OPTIONS } = require('./apTs');
const { WBJEE_QUOTA_OPTIONS } = require('./wbjee');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const EXAM_ALIAS_RULES = [
  { value: EXAM_AP, patterns: [/\bap\s*eamc?e?t\b/, /\bandhra\s*eamcet\b/, /\beamcet\s*ap\b/, /\beamset\b/, /\beamct\b/, /^ap$/] },
  { value: EXAM_TS, patterns: [/\bts\s*eamc?e?t\b/, /\bts\s*eams?t\b/, /\bts\s*emcet\b/, /\btseamcet\b/i, /\btsemcet\b/i, /\btelangana\s*eamcet\b/, /\beamcet\s*telangana\b/, /\beamset\b/, /^ts$/] },
  { value: EXAM_TNEA, patterns: [/\btnea\b/, /\btamil\s*nadu\s*engineering\b/] },
  { value: EXAM_KCET, patterns: [/\bkcet{1,2}\b/, /\bkarnataka\s*cet\b/] },
  { value: EXAM_KEAM, patterns: [/\bkeam\b/, /\bkerala\s*engineering\b/] },
  { value: EXAM_WBJEE, patterns: [/\bwbj+e{1,4}\b/, /\bwest\s*bengal\s*jee\b/] },
  { value: EXAM_JEE_MAIN, patterns: [/\bjee\s*main?s?\b/, /\bmain\s*jee\b/, /\bjeemains\b/, /^jee$/] },
  { value: EXAM_JEE_ADV, patterns: [/\bjee\s*adv(?:anced)?\b/, /\badvanced\s*jee\b/, /\bjeeadv\b/] },
  { value: EXAM_MHT, patterns: [/\bmht\s*cet{1,2}\b/, /\bmhtcet{1,2}\b/, /\bmaharashtra\s*cet\b/] },
];

function normalizeTypos(text) {
  let t = String(text || '');
  t = t.replace(/\b(eamset|eamct|eamcetr)\b/gi, 'eamcet');
  t = t.replace(/\b(colage|collage|clg)\b/gi, 'college');
  t = t.replace(/\b(predction|prediciton|predicton)\b/gi, 'prediction');
  t = t.replace(/\b(admisson|admision)\b/gi, 'admission');
  t = t.replace(/\b(enginering|engeneering)\b/gi, 'engineering');
  // Romanized Telugu/Hindi cues → English-ish for extractors
  t = t.replace(/\bna\s+rank\b/gi, 'my rank');
  t = t.replace(/\beamcet\s+lo\b/gi, 'in eamcet');
  t = t.replace(/\b(anna|ra)\b/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function normalizeInput(text) {
  return normalizeTypos(text).toLowerCase().replace(/\s+/g, ' ');
}

function parseMenuDigit(text) {
  const t = String(text || '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return Number.isInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Rank / percentile parsers (unchanged — purely numeric)
// ---------------------------------------------------------------------------

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
    normalized.match(/\b(?:got|scored|secured|i\s+got)\s+(\d{1,9})\b/i) ||
    normalized.match(/\bmy\s+rank\s+(?:is\s+)?(\d{1,9})\b/i) ||
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

// ---------------------------------------------------------------------------
// Exam parser (stays regex-based because exam names are too domain-specific)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Gender — now via EntityNormalizer
// ---------------------------------------------------------------------------

function parseGenderFromText(text) {
  const raw = String(text || '');
  const hasMale = /\b(male|boy|man|men|boys)\b/i.test(raw);
  const hasFemale = /\b(female|girl|woman|women|girls|ladies|femlae|femail|femal)\b/i.test(raw);
  if (hasMale && hasFemale) return null;

  const result = normalizeEntity('gender', text);
  if (!result) return null;
  // Avoid false positives from single "m"/"f" when more context is present
  const t = normalizeInput(text);
  if ((t === 'm' || t === 'f') && t.length === 1) {
    return result.value; // explicit single-char, accept it
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Category — now via EntityNormalizer
// ---------------------------------------------------------------------------

/**
 * Map a normalized entity value back to the option object in the options array.
 * Works for both AP/TS (where label === canonical) and other exams.
 */
function matchCategoryByNormalizedValue(normalizedValue, options) {
  if (!normalizedValue || !options.length) return null;
  // Direct label match
  const direct = options.find((o) => o.label === normalizedValue || o.value === normalizedValue);
  if (direct) return direct;
  // Compact match
  const compact = normalizedValue.replace(/[\s\-_]/g, '').toUpperCase();
  return options.find((o) => {
    const lc = o.label.replace(/[\s\-_]/g, '').toUpperCase();
    const vc = (o.value || '').replace(/[\s\-_]/g, '').toUpperCase();
    return lc === compact || vc === compact;
  }) || null;
}

/**
 * Choose the right entity type for the exam's category options.
 */
function entityTypeForExam(exam) {
  if (exam === EXAM_AP || exam === EXAM_TS) return 'ap_ts_category';
  if (exam === EXAM_TNEA) return 'tnea_category';
  if (exam === EXAM_JEE_MAIN || exam === EXAM_JEE_ADV) return 'jee_category';
  // KCET, KEAM, WBJEE, MHT have diverse category codes: fall through to generic
  return null;
}

/**
 * Generic fallback: match category from free text using the options array directly.
 */
function matchCategoryOptionGeneric(text, options, focusSlot) {
  const t = normalizeInput(text);
  if (!t || !options.length) return null;

  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_CATEGORY) {
    const byId = mapById(options, digit);
    if (byId) return byId;
  }

  // Compact-token direct match
  const compact = String(text || '').trim().toUpperCase().replace(/[\s\-_]+/g, '');
  for (const opt of options) {
    const labelC = opt.label.toUpperCase().replace(/[\s\-_]+/g, '');
    const valueC = (opt.value || '').toUpperCase().replace(/[\s\-_]+/g, '');
    if (compact === labelC || (valueC && compact === valueC)) return opt;
    if (labelC && compact.includes(labelC)) return opt;
  }

  // Fuzzy: strip sentence prefix first
  const { stripSentencePrefix } = require('../entityNormalization/entityNormalizer');
  const stripped = stripSentencePrefix(text);
  const strippedC = stripped.toUpperCase().replace(/[\s\-_]+/g, '');
  for (const opt of options) {
    const labelC = opt.label.toUpperCase().replace(/[\s\-_]+/g, '');
    if (strippedC === labelC) return opt;
  }

  return null;
}

function parseCategoryFromText(text, ctx, focusSlot) {
  const options = categoryOptionsForExam(ctx);
  if (!options.length) return null;

  // 1. Menu digit (kept for backward compat / quick reply)
  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_CATEGORY) {
    const byId = mapById(options, digit);
    if (byId) {
      return {
        categoryLabel: byId.label,
        categoryN: byId.id,
        baseCategory: byId.value || byId.label,
      };
    }
  }

  // 2. Entity normalizer for well-typed exams
  const entityType = entityTypeForExam(ctx.exam);
  if (entityType) {
    const normalized = normalizeEntityValue(entityType, text);
    if (normalized) {
      const matched = matchCategoryByNormalizedValue(normalized, options);
      if (matched) {
        return {
          categoryLabel: matched.label,
          categoryN: matched.id,
          baseCategory: matched.value || matched.label,
        };
      }
    }
  }

  // 3. Generic fallback for KCET / KEAM / WBJEE / MHT
  const matched = matchCategoryOptionGeneric(text, options, focusSlot);
  if (matched) {
    return {
      categoryLabel: matched.label,
      categoryN: matched.id,
      baseCategory: matched.value || matched.label,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Admission type
// ---------------------------------------------------------------------------

function parseAdmissionFromText(text, ctx, focusSlot) {
  const options = admissionOptionsForExam(ctx.exam);
  if (!options.length) return null;

  // Digit shortcut
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

  // Entity normalizer for KCET
  if (ctx.exam === EXAM_KCET) {
    const normalized = normalizeEntityValue('kcet_admission', text);
    if (normalized) {
      const opt = options.find((o) => o.value === normalized);
      if (opt) return { admissionType: opt.value, admission_category_name_enum: opt.apiValue || opt.value };
    }
  }

  // Entity normalizer for MHT CET — only when admission slot is active or input is explicit
  if (ctx.exam === EXAM_MHT) {
    const isDigitOnly = /^\d+$/.test(String(text || '').trim());
    const allowAdmissionNl =
      focusSlot === SLOT_ADMISSION_TYPE ||
      (!isDigitOnly &&
        /\b(state[\s-]*level|home[\s-]*university|other\s+(than\s+)?home|ohu|hu|sl)\b/i.test(text));
    if (allowAdmissionNl) {
      const normalized = normalizeEntityValue('mhtcet_admission', text);
      if (normalized) {
        const opt = options.find((o) => o.value === normalized);
        if (opt) return { admissionType: opt.value, admission_category_name_enum: opt.apiValue || opt.value };
      }
    }
  }

  // Generic label matching — avoid inferring admission type from exam/rank/percentile sentences
  if (focusSlot === SLOT_ADMISSION_TYPE) {
    const t = normalizeInput(text);
    for (const opt of options) {
      if (t === normalizeInput(opt.label) || t.includes(normalizeInput(opt.label))) {
        return { admissionType: opt.value, admission_category_name_enum: opt.apiValue || opt.value };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Quota / Region
// ---------------------------------------------------------------------------

function parseQuotaFromText(text, focusSlot) {
  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_QUOTA) {
    const mapped = mapById(WBJEE_QUOTA_OPTIONS, digit);
    if (mapped) return { quota: mapped.value };
  }
  const normalized = normalizeEntityValue('wbjee_quota', text);
  if (normalized) return { quota: normalized };
  return null;
}

function parseRegionFromText(text, focusSlot) {
  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_REGION) {
    const region = mapById(AP_REGION_OPTIONS, digit);
    if (region) return { admission_category_name_enum: region.value };
  }
  const normalized = normalizeEntityValue('ap_region', text);
  if (normalized) return { admission_category_name_enum: normalized };
  return null;
}

// ---------------------------------------------------------------------------
// Kept for backward compatibility (matchCategoryOption exported)
// ---------------------------------------------------------------------------

function matchCategoryOption(text, options, focusSlot) {
  const digit = parseMenuDigit(text);
  if (digit != null && focusSlot === SLOT_CATEGORY) {
    const byId = mapById(options, digit);
    if (byId) return byId;
  }
  // Attempt entity normalizer against ap_ts_category first, then generic
  const entityTypes = ['ap_ts_category', 'jee_category', 'tnea_category'];
  for (const et of entityTypes) {
    const normalized = normalizeEntityValue(et, text);
    if (normalized) {
      const found = matchCategoryByNormalizedValue(normalized, options);
      if (found) return found;
    }
  }
  return matchCategoryOptionGeneric(text, options, focusSlot);
}

// ---------------------------------------------------------------------------
// Main export: extractSlotsFromMessage
// ---------------------------------------------------------------------------

function extractSlotsFromMessage(rawText, ctx = {}) {
  const text = normalizeTypos(rawText);
  const missing = getMissingSlots(ctx);
  const focus = missing[0] || null;
  const updates = {};

  const menuDigit = parseMenuDigit(text);
  const exam = parseExamFromText(text, focus);
  if (exam) updates.exam = exam;

  const examForRank = updates.exam || ctx.exam;
  const percentile = parsePercentileValue(text);
  const bareDigitOnly =
    menuDigit != null && String(text || '').trim() === String(menuDigit);
  // Bare menu digits (1, 2, …) must only fill percentile when that slot is active.
  // Otherwise MHT admission/category digits corrupt a previously captured percentile.
  if (
    percentile != null &&
    !(focus === SLOT_EXAM && menuDigit != null) &&
    (
      focus === SLOT_PERCENTILE ||
      (!bareDigitOnly &&
        (examForRank === EXAM_MHT ||
          /\bpercentile\b/i.test(text) ||
          /\b\d+(?:\.\d+)?\s*%/.test(text) ||
          /\bmy\s+percentile\s+is\b/i.test(text)))
    )
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
    // Only accept digit-based category picks when explicitly in category slot
    const isDigitInput = /^\d+$/.test(String(text || '').trim());
    const categoryFromDigit = isDigitInput && focus !== SLOT_CATEGORY;
    if (category && !categoryFromDigit) Object.assign(updates, category);
    else if (
      focus !== SLOT_CATEGORY &&
      examCtx.exam &&
      !isDigitInput &&
      /\b(bc[\s-]?[a-e]|sc|st|ews|oc|obc|general|gen|open|gopens|gobc|gsc)\b/i.test(text)
    ) {
      const semanticCategory = parseCategoryFromText(
        text,
        { ...examCtx, ...updates },
        SLOT_CATEGORY
      );
      if (semanticCategory) Object.assign(updates, semanticCategory);
    }

    const gender = parseGenderFromText(text);
    const isDigitOnly = /^\d+$/.test(String(text || '').trim());
    const isClearGenderStatement = /\b(male|female|boy|girl|man|woman)\b/i.test(text) ||
      (!isDigitOnly && parseGenderFromText(text) != null);
    if (gender && (focus === SLOT_GENDER || isClearGenderStatement)) {
      updates.gender = gender;
    } else if (!isDigitOnly && /\b(male|female|boy|girl)\b/i.test(text)) {
      const fallbackGender = parseGenderFromText(text);
      if (fallbackGender) updates.gender = fallbackGender;
    }

    const quota = parseQuotaFromText(text, focus === SLOT_QUOTA ? SLOT_QUOTA : null);
    if (quota && (focus === SLOT_QUOTA || !/^\d+$/.test(String(text || '').trim()))) {
      Object.assign(updates, quota);
    }

    if (examCtx.exam === EXAM_AP) {
      const region = parseRegionFromText(text, focus === SLOT_REGION ? SLOT_REGION : null);
      if (region && (focus === SLOT_REGION || !/^\d+$/.test(String(text || '').trim()))) {
        Object.assign(updates, region);
      }
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
  normalizeTypos,
};
