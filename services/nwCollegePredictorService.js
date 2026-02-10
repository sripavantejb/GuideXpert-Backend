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
    const err = new Error('Predictor service not configured');
    err.http_status_code = 503;
    err.res_status = 'SERVICE_UNAVAILABLE';
    err.response = 'Predictor service not configured';
    throw err;
  }

  const url = `${BASE_URL}${PATH}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (process.env.NW_PREDICTORS_X_SOURCE) {
    headers['X-Source'] = process.env.NW_PREDICTORS_X_SOURCE;
  }

  const payload = {
    entrance_exam_name_enum: body.entrance_exam_name_enum,
    admission_category_name_enum: body.admission_category_name_enum,
    cutoff_from: body.cutoff_from,
    cutoff_to: body.cutoff_to,
    reservation_category_code: body.reservation_category_code,
  };
  if (Array.isArray(body.branch_codes)) payload.branch_codes = body.branch_codes;
  else if (body.branch_codes != null) payload.branch_codes = body.branch_codes;
  if (Array.isArray(body.districts)) payload.districts = body.districts;
  else if (body.districts != null) payload.districts = body.districts || [];
  if (body.sort_order != null && body.sort_order !== '') payload.sort_order = body.sort_order;

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
