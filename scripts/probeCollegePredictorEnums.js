/**
 * Dev-only: probe earlywave college predictor for JEE exam enums and reservation codes.
 *
 * Usage (from GuideXpert-Backend):
 *   node scripts/probeCollegePredictorEnums.js
 *   node scripts/probeCollegePredictorEnums.js --matrix   # edge cases (v1/v2, branches, bad sort)
 *
 * Requires COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN in .env
 * Optional: NW_PREDICTORS_BASE_URL (defaults to beta earlywave).
 * Default: legacy wrapped (matches beta earlywave). For Swagger-flat hosts: NW_PREDICTORS_USE_OPENAPI_FLAT_BODY=true
 */

require('dotenv').config();

const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';
const V2_PATH = '/api/nw_college_predictor/colleges/get/v2/';

function useLegacyWrappedPayload() {
  if (String(process.env.NW_PREDICTORS_USE_OPENAPI_FLAT_BODY || '').trim() === 'true') {
    return false;
  }
  const leg = String(process.env.NW_PREDICTORS_LEGACY_WRAPPED_PAYLOAD || '').trim().toLowerCase();
  if (leg === 'false') return false;
  return true;
}

const EXAM_CANDIDATES = [
  'JEE',
  'JEE_MAIN',
  'JEE_ADVANCED',
  'JEE_ADVANCE',
  'JEEMAIN',
  'JEEADVANCED',
  'JEE_MAINS',
  'MAIN',
  'ADVANCED',
];

const RESERVATION_CANDIDATES = [
  'OPEN',
  'OPEN (PwD)',
  'EWS',
  'EWS (PwD)',
  'OBC-NCL',
  'OBC-NCL (PwD)',
  'SC',
  'SC (PwD)',
  'ST',
  'ST (PwD)',
];

const ADMISSION_CANDIDATES = ['GENERAL', 'MAIN', 'ADVANCED', 'JEE_MAIN', 'JEE_ADVANCED'];

function buildInnerV1(examEnum, reservation, admission = 'GENERAL', overrides = {}) {
  return {
    entrance_exam_name_enum: examEnum,
    admission_category_name_enum: admission,
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_code: reservation,
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
    ...overrides,
  };
}

function buildInnerV2(examEnum, reservations, admission = 'GENERAL', overrides = {}) {
  return {
    entrance_exam_name_enum: examEnum,
    admission_category_name_enum: admission,
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_codes: reservations,
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
    ...overrides,
  };
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

function outboundBody(inner) {
  return useLegacyWrappedPayload() ? wrapLegacy(inner) : inner;
}

async function postV1(inner) {
  const token = process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    return { skip: true, reason: 'No COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN' };
  }
  const url = `${BASE_URL}${V1_PATH}?offset=0&limit=3`;
  const body = outboundBody(inner);
  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    timeout: 25000,
    validateStatus: () => true,
  });
  const resData = res.data || {};
  const ok = res.status >= 200 && res.status < 300;
  const collegesLen = Array.isArray(resData.colleges) ? resData.colleges.length : 0;
  return {
    status: res.status,
    ok,
    res_status: resData.res_status,
    response: resData.response,
    total_no_of_colleges: resData.total_no_of_colleges,
    colleges_sample: collegesLen,
  };
}

async function postV2(inner) {
  const token = process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    return { skip: true, reason: 'No token' };
  }
  const url = `${BASE_URL}${V2_PATH}?offset=0&limit=3`;
  const body = outboundBody(inner);
  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    timeout: 25000,
    validateStatus: () => true,
  });
  const resData = res.data || {};
  const ok = res.status >= 200 && res.status < 300;
  return {
    status: res.status,
    ok,
    res_status: resData.res_status,
    response: resData.response,
    total_no_of_colleges: resData.total_no_of_colleges,
  };
}

async function runEdgeMatrix() {
  console.log('\n=== --matrix: edge cases (same outbound mode as main probe) ===\n');
  console.log('legacyWrapped:', useLegacyWrappedPayload(), '| flat:', !useLegacyWrappedPayload());

  const base = buildInnerV1('KCET', '1G', 'GENERAL');
  let r = await postV1({ ...base, branch_codes: [] });
  console.log('v1 KCET branch_codes []     ', `HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'}`);

  r = await postV1({ ...base, branch_codes: ['CS'] });
  console.log('v1 KCET branch_codes [CS] ', `HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'}`);

  r = await postV1({ ...base, sort_order: 'BAD' });
  console.log('v1 KCET sort_order BAD      ', `HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'}`);

  r = await postV1({ ...base, entrance_exam_name_enum: '__INVALID_EXAM__' });
  console.log('v1 invalid exam enum        ', `HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'}`);

  const v2inner = buildInnerV2('KCET', ['1G', '2G'], 'GENERAL');
  r = await postV2(v2inner);
  console.log('v2 KCET multi reservation   ', `HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'}`);

  console.log('\nMatrix done.\n');
}

async function main() {
  const token = process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
  if (!token || !String(token).trim()) {
    console.error('Missing COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN — probe skipped.');
    console.error('Documented matrix (run with token to verify):');
    console.error('  - Prefer JEE_MAIN / JEE_ADVANCED if API returns 200; else JEE + admission MAIN/ADVANCED.');
    process.exit(1);
  }

  console.log('Base URL:', BASE_URL);
  console.log('POST body mode:', useLegacyWrappedPayload() ? 'legacy wrapped' : 'OpenAPI flat');
  console.log('\n--- Matrix: exam enum × OPEN reservation (admission GENERAL) ---\n');

  for (const exam of EXAM_CANDIDATES) {
    const inner = buildInnerV1(exam, 'OPEN', 'GENERAL');
    const r = await postV1(inner);
    console.log(
      `${exam.padEnd(16)} HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'} total=${r.total_no_of_colleges ?? '-'}`
    );
    if (!r.ok && r.response) console.log('    ', String(r.response).slice(0, 120));
  }

  console.log('\n--- JEE only: admission_category variants (reservation OPEN) ---\n');
  for (const adm of ADMISSION_CANDIDATES) {
    const r = await postV1(buildInnerV1('JEE', 'OPEN', adm));
    console.log(
      `JEE + admission ${adm.padEnd(14)} HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'} total=${r.total_no_of_colleges ?? '-'}`
    );
  }

  console.log('\n--- Working exam (first that returned ok with OPEN): re-check all reservation strings ---\n');
  let workingExam = null;
  for (const exam of EXAM_CANDIDATES) {
    const r = await postV1(buildInnerV1(exam, 'OPEN', 'GENERAL'));
    if (r.ok) {
      workingExam = exam;
      break;
    }
  }
  if (!workingExam) {
    for (const adm of ADMISSION_CANDIDATES) {
      const r = await postV1(buildInnerV1('JEE', 'OPEN', adm));
      if (r.ok) {
        workingExam = `JEE+admission=${adm}`;
        break;
      }
    }
  }

  if (!workingExam) {
    console.log('No combination succeeded with OPEN.');
  } else if (workingExam.includes('admission=')) {
    console.log('Using', workingExam, '(split on + for probe script extension)');
  } else {
    for (const res of RESERVATION_CANDIDATES) {
      const r = await postV1(buildInnerV1(workingExam, res, 'GENERAL'));
      console.log(
        `${res.padEnd(18)} HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'}`
      );
    }
  }

  if (process.argv.includes('--matrix')) {
    await runEdgeMatrix();
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
