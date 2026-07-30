'use strict';

const { applyLegacyMirrors } = require('../profile/flowV3LegacyMirror');
const {
  BLOCKED_REPLY_TEXT,
  isBlockedDemographic,
  resolveLegacyExam,
  getR4PMissingSlots,
  buildPredictorCtxFromProfile,
} = require('../../flowV2/nodes/r4pPredictor');
const { buildPredictionContext } = require('../../whatsappCollegePredictor/collegePredictorSlots');
const { PAGE_SIZE } = require('../../whatsappCollegePredictor/collegePredictorSessionService');
const defaultFetchCollegeDostColleges = require('../../../collegePredictorCore').fetchCollegeDostColleges;
const { isNonAuthoritativeSource } = require('../../../../constants/flowV3/flowV3ProfileEnums');

/** TODO(copy): shortlist disclosure string for predictor top matches — currently empty by design. */
const DISCLOSURE = '';

const PREDICTOR_TIMEOUT_MS = 3000;

/** Normalize common free-text / lowercase aliases before S-1 gate. */
const EXAM_ALIASES = Object.freeze({
  ap_eamcet: 'AP_EAMCET',
  apeamcet: 'AP_EAMCET',
  'ap eamcet': 'AP_EAMCET',
  ts_eamcet: 'TS_EAMCET',
  tseamcet: 'TS_EAMCET',
  'ts eamcet': 'TS_EAMCET',
});

function normalizeExamType(examType) {
  if (examType == null || examType === '') return null;
  const raw = String(examType).trim();
  const aliased = EXAM_ALIASES[raw.toLowerCase()] || raw;
  return resolveLegacyExam(aliased) || aliased;
}

const LEGACY_SLOT_TO_FIELD = Object.freeze({
  exam: 'examType',
  rank: 'rank',
  percentile: 'percentile',
  category: 'category',
  gender: 'gender',
  quota: 'quota',
  region: 'region',
  admission_type: 'admissionType',
});

const PREDICTOR_FIELDS = Object.freeze([
  'examType',
  'rank',
  'percentile',
  'category',
  'gender',
  'quota',
  'region',
  'admissionType',
]);

function buildCounsellorStyleRequestBody(ctx) {
  const body = { exam: ctx.exam };
  if (ctx.rank != null) body.rank = ctx.rank;
  if (ctx.cutoff_from != null) body.cutoff_from = ctx.cutoff_from;
  if (ctx.cutoff_to != null) body.cutoff_to = ctx.cutoff_to;
  if (Array.isArray(ctx.reservation_category_codes)) {
    body.reservation_category_codes = ctx.reservation_category_codes;
  }
  if (ctx.admission_category_name_enum) {
    body.admission_category_name_enum = ctx.admission_category_name_enum;
  }
  if (ctx.quota) body.quota = ctx.quota;
  return body;
}

function mapMissingToNeeds(missingLegacySlots = []) {
  return missingLegacySlots.map((slot) => LEGACY_SLOT_TO_FIELD[slot] || slot);
}

function inferredPredictorFields(slotMeta = {}) {
  return PREDICTOR_FIELDS.filter((field) => {
    const meta = slotMeta[field];
    return meta && isNonAuthoritativeSource(meta.source);
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('predictor_timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeCollegeRow(row) {
  const name = row.college_name || row.collegeName || row.name || null;
  return {
    ...row,
    college_name: name,
    collegeName: name,
    catalog: 'predictor',
  };
}

/**
 * M-1 predictor matches — CollegeDost top page only, catalog:'predictor'.
 * Refuses blocked demographics BEFORE any data access (verbatim BLOCKED_REPLY_TEXT).
 * @param {{ profile?: object, slotMeta?: object, limit?: number, timeoutMs?: number }} args
 * @param {{ deps?: { fetchCollegeDostColleges?: Function } }} [_ctx]
 */
async function run(args = {}, _ctx = {}) {
  const fetchFn =
    (_ctx.deps && _ctx.deps.fetchCollegeDostColleges) || defaultFetchCollegeDostColleges;
  const slotMeta = args.slotMeta || {};
  // One-directional mirror only: examResults[isPrimary] → flat fields. An
  // unresolved primary (multiple entries, none flagged) refuses to guess —
  // the guessing path in the deleted flowV3ExamMirror fed arbitrary ranks
  // into the S-1 gate.
  const profile = applyLegacyMirrors(args.profile || {}).profile;
  // Normalize Flow V2 / free-text exam aliases to canonical AP_EAMCET / TS_EAMCET
  // before the S-1 demographic gate (isBlockedDemographic keys on EXAM_AP).
  const canonicalExam = normalizeExamType(profile.examType);
  if (canonicalExam) profile.examType = canonicalExam;

  if (isBlockedDemographic(profile)) {
    return {
      ok: true,
      refused: true,
      copy: BLOCKED_REPLY_TEXT,
      total_no_of_colleges: 0,
      colleges: [],
    };
  }

  const missingLegacy = getR4PMissingSlots(profile);
  if (missingLegacy.length > 0) {
    const needs = mapMissingToNeeds(missingLegacy);
    const inferredOnly = inferredPredictorFields(slotMeta).filter((f) => needs.includes(f));
    return {
      ok: true,
      needs,
      ...(inferredOnly.length
        ? { note: 'inferred_cannot_satisfy_predictor', inferredFields: inferredOnly }
        : {}),
    };
  }

  const predictorCtxSeed = buildPredictorCtxFromProfile(profile);
  const built = buildPredictionContext(predictorCtxSeed);
  if (built.blocked) {
    return {
      ok: true,
      refused: true,
      copy: BLOCKED_REPLY_TEXT,
      total_no_of_colleges: 0,
      colleges: [],
    };
  }
  if (built.error) {
    return { ok: false, error: built.error };
  }

  const predictCtx = built.ctx;
  const requestBody = buildCounsellorStyleRequestBody(predictCtx);
  const fetchLimit = Math.max(PAGE_SIZE * 5, 25);
  const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : PREDICTOR_TIMEOUT_MS;

  let data;
  try {
    data = await withTimeout(
      fetchFn(predictCtx.exam, 0, fetchLimit, requestBody),
      timeoutMs
    );
  } catch (err) {
    const timedOut = err && err.message === 'predictor_timeout';
    return {
      ok: false,
      error: timedOut ? 'predictor_timeout' : err.message || 'predictor_fetch_failed',
    };
  }

  const allColleges = data?.colleges || [];
  const topLimit = Math.min(Number(args.limit) > 0 ? Number(args.limit) : PAGE_SIZE, PAGE_SIZE);
  const topColleges = allColleges.slice(0, topLimit).map(normalizeCollegeRow);

  return {
    ok: true,
    total_no_of_colleges: data?.total_no_of_colleges ?? allColleges.length,
    admission_category_name: data?.admission_category_name ?? predictCtx.admission_category_name_enum ?? null,
    colleges: topColleges,
    disclosure: DISCLOSURE,
    exam: resolveLegacyExam(profile.examType),
  };
}

module.exports = {
  run,
  DISCLOSURE,
  PREDICTOR_TIMEOUT_MS,
  LEGACY_SLOT_TO_FIELD,
  normalizeExamType,
};
