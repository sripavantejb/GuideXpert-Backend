const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';

const SUPPORTED_EXAMS = [
  'KCET', 'MHT_CET', 'KEAM', 'AP_EAMCET', 'TS_EAMCET', 'TNEA', 'JEE',
];

/**
 * Call the earlywave v1 college predictor API.
 *
 * v1 payload rules:
 *   - `data` is a JSON string wrapped in single quotes: "'{...}'"
 *   - `reservation_category_code` is a single string, not an array
 *   - `branch_codes` must be present (array, can be empty)
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

  if (!SUPPORTED_EXAMS.includes(exam)) {
    const err = new Error(`Unsupported exam: ${exam}`);
    err.http_status_code = 400;
    err.res_status = 'INVALID_ENTRANCE_EXAM';
    err.response = `Unsupported exam "${exam}". Supported: ${SUPPORTED_EXAMS.join(', ')}`;
    throw err;
  }

  const url = `${BASE_URL}${V1_PATH}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`;

  // v1 uses a single reservation_category_code string
  let reservationCode = '';
  if (Array.isArray(body.reservation_category_codes) && body.reservation_category_codes.length > 0) {
    reservationCode = body.reservation_category_codes[0];
  } else if (body.reservation_category_code) {
    reservationCode = String(body.reservation_category_code).trim();
  }
  if (!reservationCode) {
    reservationCode = '1G';
  }

  const innerBody = {
    entrance_exam_name_enum: body.entrance_exam_name_enum || exam,
    admission_category_name_enum: body.admission_category_name_enum || 'GENERAL',
    cutoff_from: body.cutoff_from,
    cutoff_to: body.cutoff_to,
    reservation_category_code: reservationCode,
    branch_codes: Array.isArray(body.branch_codes) ? body.branch_codes : [],
    districts: Array.isArray(body.districts) ? body.districts : [],
    sort_order: body.sort_order || 'ASC',
  };

  // v1 format: data is JSON wrapped in single-quote delimiters
  const dataValue = "'" + JSON.stringify(innerBody) + "'";
  const requestPayload = {
    clientKeyDetailsId: 1,
    data: dataValue,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[collegeDost] exam:', exam, '| url:', url);
  }

  try {
    const res = await axios.post(url, requestPayload, {
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

module.exports = { getPredictedColleges, SUPPORTED_EXAMS };
