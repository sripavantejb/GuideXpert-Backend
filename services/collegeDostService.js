const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';
const V2_PATH = '/api/nw_college_predictor/colleges/get/v2/';

/**
 * nw-predictors-backend-beta expects { clientKeyDetailsId, data, branch_codes } (legacy).
 * Local/OpenAPI hosts (Swagger `api_spec 69.json`) expect flat JSON — set NW_PREDICTORS_USE_OPENAPI_FLAT_BODY=true.
 */
function useLegacyWrappedPayload() {
  if (String(process.env.NW_PREDICTORS_USE_OPENAPI_FLAT_BODY || '').trim() === 'true') {
    return false;
  }
  const leg = String(process.env.NW_PREDICTORS_LEGACY_WRAPPED_PAYLOAD || '').trim().toLowerCase();
  if (leg === 'false') return false;
  return true;
}

/**
 * OpenAPI (Swagger) body: flat JSON matching PredictedCollegeDetailsParameter / V2.
 * Legacy gateway: { clientKeyDetailsId, data: "'{...}'", branch_codes }.
 */
function buildOutboundBody(inner) {
  if (!useLegacyWrappedPayload()) {
    return inner;
  }
  const dataJson = JSON.stringify(inner);
  const usePlainData = process.env.NW_PREDICTORS_DATA_PLAIN === 'true';
  const dataValue = usePlainData ? dataJson : "'" + dataJson + "'";
  return {
    clientKeyDetailsId: 1,
    data: dataValue,
    branch_codes: Array.isArray(inner.branch_codes) ? inner.branch_codes : [],
  };
}

/**
 * Maps frontend exam keys to the API enum values the earlywave backend accepts.
 * Some frontend keys differ from the API enum (e.g. MHT_CET -> MHTCET).
 */
const EXAM_API_MAP = {
  KCET: 'KCET',
  MHT_CET: 'MHTCET',
  MHTCET: 'MHTCET',
  KEAM: 'KEAM',
  AP_EAMCET: 'AP_EAMCET',
  TS_EAMCET: 'TS_EAMCET',
  TNEA: 'TNEA',
  JEE: 'JEE',
  /** Combined predictor UI uses these for parallel Main vs Advanced calls (beta may return INVALID_ENTRANCE_EXAM until upstream enables). */
  JEE_MAIN: 'JEE_MAIN',
  JEE_ADVANCED: 'JEE_ADVANCED',
};

const SUPPORTED_EXAMS = Object.keys(EXAM_API_MAP);

/** Default reservation when none sent — AP EAMCET uses EAPCET category strings (e.g. OC GIRLS), not KCET 1G. */
const DEFAULT_RESERVATION_BY_API_EXAM = {
  KCET: '1G',
  AP_EAMCET: 'OC GIRLS',
  TS_EAMCET: 'OC BOYS',
  MHTCET: 'GOPENS',
  JEE: 'OPEN',
  JEE_MAIN: 'OPEN',
  JEE_ADVANCED: 'OPEN',
};

/**
 * @param {string} raw
 * @returns {string} First matching key in EXAM_API_MAP (e.g. MHT_CET before MHTCET when both map to MHTCET)
 */
function canonicalExamKey(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return s;
  if (SUPPORTED_EXAMS.includes(s)) return s;
  for (const [k, v] of Object.entries(EXAM_API_MAP)) {
    if (v === s) return k;
  }
  return s;
}

/**
 * True if `raw` is a known frontend key or a known API enum value.
 */
function isSupportedExamInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (SUPPORTED_EXAMS.includes(s)) return true;
  return Object.values(EXAM_API_MAP).includes(s);
}

function pickDefaultReservation(apiExamEnum) {
  return DEFAULT_RESERVATION_BY_API_EXAM[apiExamEnum] || '1G';
}

/**
 * Earlywave MHTCET dataset does not accept PWDSEBCS / PWDSEBCO (INVALID_RESERVATION_CATEGORY_CODE on SL/HU/OHU).
 * CAP PWD SEBC–style selections map to PWDROBCS, which validates upstream.
 */
function normalizeMhtCetReservationCodeForUpstream(apiExamEnum, code) {
  if (apiExamEnum !== 'MHTCET') return String(code ?? '').trim();
  const c = String(code ?? '').trim();
  if (c === 'PWDSEBCS' || c === 'PWDSEBCO' || c === 'PWDSEBCH') return 'PWDROBCS';
  return c;
}

function buildReservationCodeFromBody(body, apiExamEnum) {
  let reservationCode = '';
  if (Array.isArray(body.reservation_category_codes) && body.reservation_category_codes.length > 0) {
    reservationCode = String(body.reservation_category_codes[0]).trim();
  } else if (body.reservation_category_code) {
    reservationCode = String(body.reservation_category_code).trim();
  }
  if (!reservationCode) {
    reservationCode = pickDefaultReservation(apiExamEnum);
  }
  return normalizeMhtCetReservationCodeForUpstream(apiExamEnum, reservationCode);
}

function buildInnerBodyV1(body, apiExamEnum) {
  const reservationCode = buildReservationCodeFromBody(body, apiExamEnum);
  return {
    entrance_exam_name_enum: apiExamEnum,
    admission_category_name_enum: body.admission_category_name_enum || 'GENERAL',
    cutoff_from: Number(body.cutoff_from),
    cutoff_to: Number(body.cutoff_to),
    reservation_category_code: reservationCode,
    branch_codes: Array.isArray(body.branch_codes) ? body.branch_codes : [],
    districts: Array.isArray(body.districts) ? body.districts : [],
    sort_order: body.sort_order || 'ASC',
  };
}

function buildInnerBodyV2(body, apiExamEnum) {
  let codes = [];
  if (Array.isArray(body.reservation_category_codes) && body.reservation_category_codes.length > 0) {
    codes = body.reservation_category_codes.map((c) => String(c).trim()).filter(Boolean);
  } else if (body.reservation_category_code) {
    codes = [String(body.reservation_category_code).trim()];
  }
  if (codes.length === 0) {
    codes = [pickDefaultReservation(apiExamEnum)];
  }
  codes = codes.map((c) => normalizeMhtCetReservationCodeForUpstream(apiExamEnum, c));
  return {
    entrance_exam_name_enum: apiExamEnum,
    admission_category_name_enum: body.admission_category_name_enum || 'GENERAL',
    cutoff_from: Number(body.cutoff_from),
    cutoff_to: Number(body.cutoff_to),
    reservation_category_codes: codes,
    branch_codes: Array.isArray(body.branch_codes) ? body.branch_codes : [],
    districts: Array.isArray(body.districts) ? body.districts : [],
    sort_order: body.sort_order || 'ASC',
  };
}

/**
 * Call the earlywave v1 college predictor API (optionally v2 on reservation validation failure).
 *
 * Default POST matches deployed beta: legacy `{ clientKeyDetailsId, data, branch_codes }`.
 * OpenAPI flat JSON: set NW_PREDICTORS_USE_OPENAPI_FLAT_BODY=true (e.g. local Swagger host).
 *
 * @param {string} exam
 * @param {number} offset
 * @param {number} limit
 * @param {object} body - Inner payload from the controller
 * @returns {Promise<object>} { total_no_of_colleges, admission_category_name, colleges }
 */
async function getPredictedColleges(exam, offset, limit, body) {
  const token = process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    const err = new Error('Access token is not configured');
    err.http_status_code = 503;
    err.res_status = 'SERVICE_UNAVAILABLE';
    err.response = 'College predictor service is not configured. Please contact support.';
    throw err;
  }

  if (!isSupportedExamInput(exam)) {
    const err = new Error(`Unsupported exam: ${exam}`);
    err.http_status_code = 400;
    err.res_status = 'INVALID_ENTRANCE_EXAM';
    err.response = `Unsupported exam "${exam}". Supported: ${SUPPORTED_EXAMS.join(', ')}`;
    throw err;
  }

  const examKey = canonicalExamKey(exam);
  const apiExamEnum = EXAM_API_MAP[examKey] || examKey;

  const urlV1 = `${BASE_URL}${V1_PATH}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`;
  const innerV1 = buildInnerBodyV1(body, apiExamEnum);
  const requestPayloadV1 = buildOutboundBody(innerV1);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[collegeDost] exam:', exam, '-> key:', examKey, 'apiEnum:', apiExamEnum, '| url:', urlV1);
    console.log('[collegeDost] legacyWrapped:', useLegacyWrappedPayload());
    console.log('[collegeDost] outbound v1 body:', JSON.stringify(requestPayloadV1));
  }

  try {
    const res = await axios.post(urlV1, requestPayloadV1, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
      return res.data;
    }

    const errBody = res.data || {};
    const shouldTryV2 =
      res.status === 400 &&
      errBody.res_status === 'INVALID_RESERVATION_CATEGORY_CODE' &&
      Array.isArray(body.reservation_category_codes) &&
      body.reservation_category_codes.length > 1;

    if (shouldTryV2) {
      const urlV2 = `${BASE_URL}${V2_PATH}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`;
      const innerV2 = buildInnerBodyV2(body, apiExamEnum);
      const payloadV2 = buildOutboundBody(innerV2);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[collegeDost] outbound v2 body:', JSON.stringify(payloadV2));
      }
      const res2 = await axios.post(
        urlV2,
        payloadV2,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          timeout: 30000,
          validateStatus: () => true,
        }
      );
      if (res2.status >= 200 && res2.status < 300) {
        return res2.data;
      }
      const err2 = res2.data || {};
      const err = new Error(err2.response || `Predictor API v2 returned ${res2.status}`);
      err.http_status_code = err2.http_status_code ?? res2.status;
      err.res_status = err2.res_status || 'UPSTREAM_ERROR';
      err.response = err2.response || err.message;
      err.upstreamBody = err2;
      throw err;
    }

    const err = new Error(errBody.response || `Predictor API returned ${res.status}`);
    err.http_status_code = errBody.http_status_code ?? res.status;
    err.res_status = errBody.res_status || 'UPSTREAM_ERROR';
    err.response = errBody.response || err.message;
    err.upstreamBody = errBody;
    throw err;
  } catch (error) {
    if (error.http_status_code != null) throw error;
    const err = new Error(
      error.code === 'ECONNABORTED' ? 'Predictor request timed out' :
      error.message === 'Network Error' ? 'Cannot reach predictor service' :
      error.message
    );
    err.http_status_code = 502;
    err.res_status = 'SERVICE_UNAVAILABLE';
    err.response = err.message;
    throw err;
  }
}

module.exports = {
  getPredictedColleges,
  SUPPORTED_EXAMS,
  EXAM_API_MAP,
  canonicalExamKey,
  isSupportedExamInput,
};
