/**
 * Shared college predictor request path for counsellor HTTP API and WhatsApp chatbot.
 * Builds the same payload and calls collegeDostService — no separate env or token logic.
 */
const {
  getPredictedColleges: getCollegeDostPredicted,
  canonicalExamKey,
  isSupportedExamInput,
} = require('./collegeDostService');
const { rankToCutoff } = require('../utils/rankToCutoff');

function normalizeCollegePredictorBody(body) {
  const toStrArray = (v) => {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  };
  body.branch_codes = toStrArray(body.branch_codes);
  body.districts = toStrArray(body.districts);
}

function isJeeExamEnum(value) {
  const v = String(value || '').trim();
  return v === 'JEE_MAINS_2024' || v === 'JEE_ADVANCE_2024' || v === 'JEE_MAIN' || v === 'JEE_ADVANCED';
}

function isWbjeeExamEnum(value) {
  const v = String(value || '').trim();
  return v === 'WBJEE_2024' || v === 'WBJEE' || v === 'WBJEE_JEE_MAINS_2024';
}

function needsDefaultAdmissionEnum(value) {
  return isJeeExamEnum(value) || isWbjeeExamEnum(value);
}

function tryDeriveRankCutoffs(body, exam) {
  const hasFrom = body.cutoff_from !== undefined && body.cutoff_from !== null && body.cutoff_from !== '';
  const hasTo = body.cutoff_to !== undefined && body.cutoff_to !== null && body.cutoff_to !== '';
  if (hasFrom && hasTo) return false;

  let rankValue = null;
  if (isWbjeeExamEnum(exam)) {
    rankValue = body.wbjee_rank ?? body.jee_main_rank ?? body.rank ?? null;
  } else {
    rankValue = body.rank ?? null;
  }

  if (rankValue === null || rankValue === '' || rankValue === undefined) return false;

  const result = rankToCutoff(rankValue);
  if (!result) return false;

  body.cutoff_from = result[0];
  body.cutoff_to = result[1];
  return true;
}

function validationError(response, res_status, http_status_code) {
  const err = new Error(response);
  err.response = response;
  err.res_status = res_status;
  err.http_status_code = http_status_code;
  return err;
}

/**
 * Same CollegeDost fetch used by POST /api/counsellor/college-predictor/colleges.
 * @param {string} exam
 * @param {number} offset
 * @param {number} limit
 * @param {object} body — exam, rank and/or cutoffs, reservation_category_codes, optional admission_category_name_enum
 */
async function fetchCollegeDostColleges(exam, offset, limit, body = {}) {
  const resolvedExam = canonicalExamKey(exam || body.exam);
  if (!isSupportedExamInput(resolvedExam)) {
    throw validationError(
      `Unsupported exam "${resolvedExam}"`,
      'INVALID_ENTRANCE_EXAM',
      400
    );
  }

  const working = { ...body, exam: resolvedExam };
  normalizeCollegePredictorBody(working);
  tryDeriveRankCutoffs(working, resolvedExam);

  const rawFrom = working.cutoff_from;
  const rawTo = working.cutoff_to;
  const cutoffFrom = rawFrom != null && rawFrom !== '' ? parseInt(Number(rawFrom), 10) : NaN;
  const cutoffTo = rawTo != null && rawTo !== '' ? parseInt(Number(rawTo), 10) : NaN;

  if (rawFrom === undefined || rawFrom === null || rawFrom === '') {
    throw validationError(
      'cutoff_from is required (or provide rank)',
      'INVALID_INPUT_FORMAT',
      400
    );
  }
  if (rawTo === undefined || rawTo === null || rawTo === '') {
    throw validationError(
      'cutoff_to is required (or provide rank)',
      'INVALID_INPUT_FORMAT',
      400
    );
  }
  if (!Number.isInteger(cutoffFrom) || cutoffFrom < 0) {
    throw validationError('cutoff_from must be a non-negative integer', 'INVALID_INPUT_FORMAT', 400);
  }
  if (!Number.isInteger(cutoffTo) || cutoffTo < 0) {
    throw validationError('cutoff_to must be a non-negative integer', 'INVALID_INPUT_FORMAT', 400);
  }
  if (cutoffFrom >= cutoffTo) {
    throw validationError('cutoff_to must be greater than cutoff_from', 'INVALID_CUTOFF_RANGE', 400);
  }

  const sortOrder =
    working.sort_order != null && working.sort_order !== ''
      ? String(working.sort_order).toUpperCase()
      : 'ASC';
  if (sortOrder !== 'ASC' && sortOrder !== 'DESC') {
    throw validationError('sort_order must be ASC or DESC', 'INVALID_INPUT_FORMAT', 400);
  }

  let reservationCodes = [];
  if (Array.isArray(working.reservation_category_codes) && working.reservation_category_codes.length > 0) {
    reservationCodes = working.reservation_category_codes;
  } else if (working.reservation_category_code) {
    reservationCodes = [String(working.reservation_category_code).trim()];
  }

  const quota =
    working.quota != null && String(working.quota).trim() !== '' ? String(working.quota).trim() : undefined;

  const payload = {
    entrance_exam_name_enum: working.entrance_exam_name_enum || resolvedExam,
    admission_category_name_enum: working.admission_category_name_enum || 'GENERAL',
    cutoff_from: cutoffFrom,
    cutoff_to: cutoffTo,
    reservation_category_codes: reservationCodes,
    branch_codes: Array.isArray(working.branch_codes) ? working.branch_codes : [],
    districts: Array.isArray(working.districts) ? working.districts : [],
    sort_order: sortOrder,
    quota,
  };

  if (
    needsDefaultAdmissionEnum(payload.entrance_exam_name_enum) ||
    needsDefaultAdmissionEnum(resolvedExam) ||
    needsDefaultAdmissionEnum(working.entrance_exam_name_enum)
  ) {
    payload.admission_category_name_enum = 'DEFAULT';
  }

  return getCollegeDostPredicted(resolvedExam, offset, limit, payload);
}

module.exports = {
  fetchCollegeDostColleges,
  normalizeCollegePredictorBody,
  tryDeriveRankCutoffs,
};
