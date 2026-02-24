const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const PATH = '/api/nw_college_predictor/colleges/get/v1/';

/** Demo data when NW_PREDICTORS_ACCESS_TOKEN is not set — same response shape as the real API. */
function getMockColleges(offset, limit, body) {
  const admissionCategoryName = (body.admission_category_name_enum || 'Demo').replace(/_/g, ' ');
  const total = 25;
  const all = Array.from({ length: total }, (_, i) => ({
    college_id: `demo-college-${i + 1}`,
    college_name: `Demo College ${i + 1}`,
    college_address: `${100 + i} Sample Road, Demo City`,
    district_enum: `district_${(i % 5) + 1}`,
    extra_info: null,
    is_promoted: i % 4 === 0,
    branches: [
      { branch_code: 'CSE', branch_name: 'Computer Science', fee: 150000, cutoff: 200 + i * 10, reservation_categories: [] },
      { branch_code: 'IT', branch_name: 'Information Technology', fee: 140000, cutoff: 190 + i * 10, reservation_categories: [] },
    ],
  }));
  const page = all.slice(offset, offset + limit);
  return {
    total_no_of_colleges: total,
    admission_category_name: admissionCategoryName,
    colleges: page,
    _demo: true,
  };
}

/**
 * Call NW College Predictor API v1 (earlywave). When token is not configured, returns demo data so the app works without credentials.
 * @param {number} offset - Pagination offset (required)
 * @param {number} limit - Number of results per page (required)
 * @param {object} body - Request body: entrance_exam_name_enum, admission_category_name_enum, cutoff_from, cutoff_to, reservation_category_code, optional branch_codes, districts, sort_order
 * @returns {Promise<object>} Upstream response: { total_no_of_colleges, admission_category_name, colleges }
 * @throws {object} On 4xx/5xx: { response, res_status, http_status_code }
 */
async function getPredictedColleges(offset, limit, body) {
  const token = process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    return getMockColleges(offset, limit, body);
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
  payload.districts = Array.isArray(body.districts) ? body.districts : (body.districts != null ? body.districts || [] : []);
  payload.sort_order = (body.sort_order != null && body.sort_order !== '') ? body.sort_order : 'ASC';

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
