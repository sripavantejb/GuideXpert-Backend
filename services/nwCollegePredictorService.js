const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const PATH = '/api/nw_college_predictor/colleges/get/v1/';

/**
 * Call NW College Predictor API v1 (earlywave).
 * @param {number} offset - Pagination offset (required)
 * @param {number} limit - Number of results per page (required)
 * @param {object} body - Request body: entrance_exam_name_enum, admission_category_name_enum, cutoff_from, cutoff_to, reservation_category_code, optional branch_codes, districts, sort_order
 * @returns {Promise<object>} Upstream response: { total_no_of_colleges, admission_category_name, colleges }
 * @throws {object} On 4xx/5xx: { response, res_status, http_status_code }
 */
async function getPredictedColleges(offset, limit, body) {
  const token = process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    throw Object.assign(new Error('NW predictor access token is not configured'), {
      response: 'Predictor service is not configured. Please contact support.',
      res_status: 'SERVICE_UNAVAILABLE',
      http_status_code: 503,
    });
  }

  const url = `${BASE_URL}${PATH}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (process.env.NW_PREDICTORS_X_SOURCE) {
    headers['X-Source'] = process.env.NW_PREDICTORS_X_SOURCE;
  }

  let entranceExam = (body.entrance_exam_name_enum != null && String(body.entrance_exam_name_enum).trim() !== '') ? String(body.entrance_exam_name_enum).trim() : '';
  if (process.env.NW_PREDICTORS_ENTRANCE_EXAM_OVERRIDE && String(process.env.NW_PREDICTORS_ENTRANCE_EXAM_OVERRIDE).trim() !== '') {
    entranceExam = String(process.env.NW_PREDICTORS_ENTRANCE_EXAM_OVERRIDE).trim();
  }
  if (!entranceExam) {
    throw Object.assign(new Error('entrance_exam_name_enum is required'), {
      response: 'entrance_exam_name_enum is required; please select an entrance exam',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  const cutoffFromInt = Number.isInteger(body.cutoff_from) ? body.cutoff_from : parseInt(Number(body.cutoff_from), 10);
  const cutoffToInt = Number.isInteger(body.cutoff_to) ? body.cutoff_to : parseInt(Number(body.cutoff_to), 10);
  const innerBody = {
    entrance_exam_name_enum: entranceExam,
    admission_category_name_enum: (body.admission_category_name_enum != null && String(body.admission_category_name_enum).trim() !== '') ? String(body.admission_category_name_enum).trim() : 'GENERAL',
    cutoff_from: Number.isInteger(cutoffFromInt) ? cutoffFromInt : 0,
    cutoff_to: Number.isInteger(cutoffToInt) ? cutoffToInt : 0,
    reservation_category_code: (body.reservation_category_code != null && String(body.reservation_category_code).trim() !== '') ? String(body.reservation_category_code).trim() : 'GNT2S',
  };
  if (Array.isArray(body.branch_codes) && body.branch_codes.length > 0) innerBody.branch_codes = body.branch_codes;
  innerBody.districts = Array.isArray(body.districts) ? body.districts : (body.districts != null ? body.districts || [] : []);
  innerBody.sort_order = (body.sort_order != null && body.sort_order !== '') ? String(body.sort_order).toUpperCase() : 'ASC';

  const dataJson = JSON.stringify(innerBody);
  // API doc: data must be JSON string wrapped in single quotes: "'{...}'"
  const usePlainData = process.env.NW_PREDICTORS_DATA_PLAIN === 'true';
  const dataValue = usePlainData ? dataJson : "'" + dataJson + "'";
  const payload = {
    clientKeyDetailsId: 1,
    data: dataValue,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[nwCollegePredictor] entrance_exam_name_enum:', entranceExam, '| data format:', usePlainData ? 'plain' : 'quoted');
  }

  try {
    const res = await axios.post(url, payload, {
      headers,
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
    if (error.http_status_code != null) {
      throw error;
    }
    const err = new Error(error.message === 'Network Error' ? 'Predictor service unavailable' : error.message);
    err.http_status_code = 502;
    err.res_status = 'SERVICE_UNAVAILABLE';
    err.response = err.message;
    err.originalError = error;
    throw err;
  }
}

module.exports = {
  getPredictedColleges,
};
