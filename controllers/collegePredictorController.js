const { getPredictedColleges: getNwPredictedColleges } = require('../services/nwCollegePredictorService');
const {
  getPredictedColleges: getCollegeDostPredicted,
  canonicalExamKey,
  isSupportedExamInput,
} = require('../services/collegeDostService');

/**
 * Coerce branch_codes / districts to string arrays so upstream always receives arrays (never null / wrong type).
 * Mutates `body` in place.
 * @param {Record<string, unknown>} body
 */
function normalizeCollegePredictorBody(body) {
  const toStrArray = (v) => {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  };
  body.branch_codes = toStrArray(body.branch_codes);
  body.districts = toStrArray(body.districts);
}

/** Normalize Swagger/OpenAPI field names onto fields the UI expects. */
function normalizePredictorResponse(data) {
  if (!data || !Array.isArray(data.colleges)) return data;
  for (const c of data.colleges) {
    if (!Array.isArray(c.branches)) continue;
    for (const b of c.branches) {
      if (!Array.isArray(b.reservation_categories)) continue;
      b.reservation_categories = b.reservation_categories.map((rc) => ({
        ...rc,
        category_name: rc.category_name ?? rc.name,
        reservation_category_code: rc.reservation_category_code ?? rc.category_code,
      }));
    }
  }
  return data;
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

const CUTOFF_UPPER_BOUND = 500000;

/**
 * Convert a student rank into [cutoff_from, cutoff_to] for the upstream API.
 * Ported from frontend collegePredictorOptions.js.
 */
function rankToCutoff(rank) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return null;
  let buffer;
  if (r <= 50) buffer = 3;
  else if (r <= 100) buffer = 10;
  else if (r <= 1000) buffer = 30;
  else if (r <= 5000) buffer = 50;
  else if (r <= 10000) buffer = 100;
  else if (r <= 16000) buffer = 500;
  else if (r <= 30000) buffer = 800;
  else if (r <= 50000) buffer = 1000;
  else if (r <= 100000) buffer = 1200;
  else buffer = 2000;
  return [Math.max(1, r - buffer), CUTOFF_UPPER_BOUND];
}

/**
 * If cutoff_from / cutoff_to are missing, try to derive them from rank fields.
 * For WBJEE: prefer wbjee_rank > jee_main_rank > rank.
 * For other exams: use rank field.
 * Mutates `body` in place. Returns true if cutoffs were set.
 */
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

/**
 * POST /college-predictor/colleges?offset=0&limit=10
 *
 * When `body.exam` is present and matches a CollegeDost-supported exam key,
 * the request is proxied to the CollegeDost per-exam endpoint.
 * Otherwise, it falls back to the original earlywave/NW service.
 */
async function getPredictedCollegesHandler(req, res) {
  const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : NaN;
  const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : NaN;

  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) {
    return res.status(400).json({
      response: 'offset and limit must be non-negative integers',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }

  const body = req.body || {};
  normalizeCollegePredictorBody(body);

  // --- CollegeDost path: route supported exams to v2 service ---
  const examFromBody = body.exam != null && String(body.exam).trim() !== '' ? String(body.exam).trim() : '';
  const examFromEnum =
    body.entrance_exam_name_enum != null && String(body.entrance_exam_name_enum).trim() !== ''
      ? String(body.entrance_exam_name_enum).trim()
      : '';
  const resolvedExam = examFromBody || examFromEnum;

  if (resolvedExam && isSupportedExamInput(resolvedExam)) {
    body.exam = canonicalExamKey(resolvedExam);
    return handleCollegeDost(req, res, offset, limit, body);
  }

  // --- Legacy earlywave/NW path ---
  return handleNwPredictor(req, res, offset, limit, body);
}

async function handleCollegeDost(req, res, offset, limit, body) {
  const exam = String(body.exam).trim();

  // Auto-derive cutoffs from rank when cutoff fields are absent.
  tryDeriveRankCutoffs(body, exam);

  const rawFrom = body.cutoff_from;
  const rawTo = body.cutoff_to;
  const cutoffFrom = rawFrom != null && rawFrom !== '' ? parseInt(Number(rawFrom), 10) : NaN;
  const cutoffTo = rawTo != null && rawTo !== '' ? parseInt(Number(rawTo), 10) : NaN;

  if (rawFrom === undefined || rawFrom === null || rawFrom === '') {
    return res.status(400).json({ response: 'cutoff_from is required (or provide rank / wbjee_rank / jee_main_rank)', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (rawTo === undefined || rawTo === null || rawTo === '') {
    return res.status(400).json({ response: 'cutoff_to is required (or provide rank / wbjee_rank / jee_main_rank)', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (!Number.isInteger(cutoffFrom) || cutoffFrom < 0) {
    return res.status(400).json({ response: 'cutoff_from must be a non-negative integer', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (!Number.isInteger(cutoffTo) || cutoffTo < 0) {
    return res.status(400).json({ response: 'cutoff_to must be a non-negative integer', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (cutoffFrom >= cutoffTo) {
    return res.status(400).json({ response: 'cutoff_to must be greater than cutoff_from', res_status: 'INVALID_CUTOFF_RANGE', http_status_code: 400 });
  }

  const sortOrder = (body.sort_order != null && body.sort_order !== '') ? String(body.sort_order).toUpperCase() : 'ASC';
  if (sortOrder !== 'ASC' && sortOrder !== 'DESC') {
    return res.status(400).json({ response: 'sort_order must be ASC or DESC', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }

  // v2 API requires all array fields to be present (even if empty)
  let reservationCodes = [];
  if (Array.isArray(body.reservation_category_codes) && body.reservation_category_codes.length > 0) {
    reservationCodes = body.reservation_category_codes;
  } else if (body.reservation_category_code) {
    reservationCodes = [String(body.reservation_category_code).trim()];
  }

  const quota = body.quota != null && String(body.quota).trim() !== '' ? String(body.quota).trim() : undefined;

  const payload = {
    entrance_exam_name_enum: body.entrance_exam_name_enum || exam,
    admission_category_name_enum: body.admission_category_name_enum || 'GENERAL',
    cutoff_from: cutoffFrom,
    cutoff_to: cutoffTo,
    reservation_category_codes: reservationCodes,
    branch_codes: Array.isArray(body.branch_codes) ? body.branch_codes : [],
    districts: Array.isArray(body.districts) ? body.districts : [],
    sort_order: sortOrder,
    quota,
  };

  // Upstream JEE & WBJEE datasets accept admission enum DEFAULT only.
  if (
    needsDefaultAdmissionEnum(payload.entrance_exam_name_enum) ||
    needsDefaultAdmissionEnum(exam) ||
    needsDefaultAdmissionEnum(body.entrance_exam_name_enum)
  ) {
    payload.admission_category_name_enum = 'DEFAULT';
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[college-predictor:collegeDost] exam:', exam, '| payload:', JSON.stringify(payload));
  }

  try {
    const data = normalizePredictorResponse(await getCollegeDostPredicted(exam, offset, limit, payload));
    return res.status(200).json(data);
  } catch (err) {
    const status = err.http_status_code || 502;
    if (status === 400 && err.upstreamBody) {
      return res.status(400).json(err.upstreamBody);
    }
    if (status === 401 || status === 403) {
      return res.status(503).json({ response: 'Predictor service unavailable', res_status: 'SERVICE_UNAVAILABLE', http_status_code: 503 });
    }
    return res.status(status).json({
      response: err.response || 'Predictor service unavailable',
      res_status: err.res_status || 'SERVICE_UNAVAILABLE',
      http_status_code: status,
    });
  }
}

async function handleNwPredictor(req, res, offset, limit, body) {
  const entranceExamRaw = body.entrance_exam_name_enum;
  const entranceExamTrimmed = (entranceExamRaw != null && String(entranceExamRaw).trim() !== '') ? String(entranceExamRaw).trim() : '';
  if (!entranceExamTrimmed) {
    return res.status(400).json({
      response: 'entrance_exam_name_enum is required; please select an entrance exam',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }

  const rawFrom = body.cutoff_from;
  const rawTo = body.cutoff_to;
  const cutoffFrom = rawFrom != null && rawFrom !== '' ? parseInt(Number(rawFrom), 10) : NaN;
  const cutoffTo = rawTo != null && rawTo !== '' ? parseInt(Number(rawTo), 10) : NaN;

  const hasFrom = rawFrom !== undefined && rawFrom !== null && rawFrom !== '';
  const hasTo = rawTo !== undefined && rawTo !== null && rawTo !== '';

  if (!hasFrom) {
    return res.status(400).json({ response: 'cutoff_from is required', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (!hasTo) {
    return res.status(400).json({ response: 'cutoff_to is required', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (!Number.isInteger(cutoffFrom) || cutoffFrom < 0) {
    return res.status(400).json({ response: 'cutoff_from must be a non-negative integer', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (!Number.isInteger(cutoffTo) || cutoffTo < 0) {
    return res.status(400).json({ response: 'cutoff_to must be a non-negative integer', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }
  if (cutoffFrom >= cutoffTo) {
    return res.status(400).json({ response: 'cutoff_to must be greater than cutoff_from', res_status: 'INVALID_CUTOFF_RANGE', http_status_code: 400 });
  }

  const sortOrder = (body.sort_order != null && body.sort_order !== '') ? String(body.sort_order).toUpperCase() : 'ASC';
  if (sortOrder !== 'ASC' && sortOrder !== 'DESC') {
    return res.status(400).json({ response: 'sort_order must be ASC or DESC', res_status: 'INVALID_INPUT_FORMAT', http_status_code: 400 });
  }

  const normalizedBody = {
    ...body,
    cutoff_from: cutoffFrom,
    cutoff_to: cutoffTo,
    entrance_exam_name_enum: entranceExamTrimmed,
    admission_category_name_enum: body.admission_category_name_enum != null && body.admission_category_name_enum !== '' ? String(body.admission_category_name_enum).trim() : 'GENERAL',
    reservation_category_code: body.reservation_category_code != null && body.reservation_category_code !== '' ? String(body.reservation_category_code).trim() : 'GNT2S',
    sort_order: sortOrder,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[college-predictor] entrance_exam_name_enum:', JSON.stringify(normalizedBody.entrance_exam_name_enum));
  }

  try {
    const data = normalizePredictorResponse(await getNwPredictedColleges(offset, limit, normalizedBody));
    return res.status(200).json(data);
  } catch (err) {
    const status = err.http_status_code || 502;
    if (status === 400 && err.upstreamBody) {
      return res.status(400).json(err.upstreamBody);
    }
    if (status === 401 || status === 403) {
      return res.status(503).json({ response: 'Predictor service unavailable', res_status: 'SERVICE_UNAVAILABLE', http_status_code: 503 });
    }
    return res.status(status).json({
      response: err.response || 'Predictor service unavailable',
      res_status: err.res_status || 'SERVICE_UNAVAILABLE',
      http_status_code: status,
    });
  }
}

module.exports = {
  getPredictedColleges: getPredictedCollegesHandler,
};
