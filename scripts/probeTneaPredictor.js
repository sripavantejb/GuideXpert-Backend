/**
 * Dev-only: probe earlywave TNEA college predictor (reservation, districts, branches, admission).
 *
 * Usage (from GuideXpert-Backend): node scripts/probeTneaPredictor.js
 * Requires COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN in .env
 *
 * Findings (beta): TNEA requires admission_category_name_enum **DEFAULT** (not GENERAL).
 * Reservation OC, BC, BCM, MBC, SC, SCA, ST return HTTP 200; districts [] and sample TN names OK.
 */

require('dotenv').config();

const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';

function useLegacyWrappedPayload() {
  if (String(process.env.NW_PREDICTORS_USE_OPENAPI_FLAT_BODY || '').trim() === 'true') {
    return false;
  }
  const leg = String(process.env.NW_PREDICTORS_LEGACY_WRAPPED_PAYLOAD || '').trim().toLowerCase();
  if (leg === 'false') return false;
  return true;
}

function wrapLegacy(inner) {
  const dataJson = JSON.stringify(inner);
  const usePlainData = process.env.NW_PREDICTORS_DATA_PLAIN === 'true';
  const dataValue = usePlainData ? dataJson : "'" + dataJson + "'";
  return {
    clientKeyDetailsId: 1,
    data: dataValue,
    branch_codes: Array.isArray(inner.branch_codes) ? inner.branch_codes : [],
  };
}

async function postV1(inner) {
  const token = process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    console.error('Missing token');
    process.exit(1);
  }
  const url = `${BASE_URL}${V1_PATH}?offset=0&limit=2`;
  const body = useLegacyWrappedPayload() ? wrapLegacy(inner) : inner;
  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    timeout: 25000,
    validateStatus: () => true,
  });
  const d = res.data || {};
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    res_status: d.res_status,
    total: d.total_no_of_colleges,
  };
}

async function main() {
  console.log('Base URL:', BASE_URL);
  const base = {
    entrance_exam_name_enum: 'TNEA',
    admission_category_name_enum: 'DEFAULT',
    cutoff_from: 1,
    cutoff_to: 500000,
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  };

  console.log('\n--- Admission category (reservation OC) ---');
  for (const adm of ['GENERAL', 'DEFAULT']) {
    const r = await postV1({ ...base, admission_category_name_enum: adm, reservation_category_code: 'OC' });
    console.log(`adm=${adm}`, r.status, r.res_status || 'OK', 'total=', r.total);
  }

  console.log('\n--- Reservation codes (DEFAULT) ---');
  for (const c of ['OC', 'BC', 'BCM', 'MBC', 'SC', 'SCA', 'ST', 'INVALID_CAT']) {
    const r = await postV1({ ...base, reservation_category_code: c });
    console.log(c, r.status, r.res_status || 'OK');
  }

  console.log('\n--- Districts / branches ---');
  let r = await postV1({ ...base, reservation_category_code: 'OC', districts: ['Chennai'] });
  console.log('Chennai', r.status, r.res_status || 'OK');
  r = await postV1({ ...base, reservation_category_code: 'OC', branch_codes: ['CSE'] });
  console.log('branch CSE', r.status, r.res_status || 'OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
