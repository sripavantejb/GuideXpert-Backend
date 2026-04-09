/**
 * Dev-only: probe earlywave JEE Main/Advanced predictor payload compatibility.
 *
 * Usage (from GuideXpert-Backend):
 *   node scripts/probeJeePredictor.js
 *   node scripts/probeJeePredictor.js --matrix
 *
 * Requires:
 *   - COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN
 * Optional:
 *   - NW_PREDICTORS_BASE_URL (default beta earlywave)
 *   - NW_PREDICTORS_USE_OPENAPI_FLAT_BODY=true to send flat payload
 *
 * Current verified (beta):
 *   - entrance_exam_name_enum: JEE_MAINS_2024, JEE_ADVANCE_2024
 *   - admission_category_name_enum: DEFAULT
 *   - valid reservation examples: OPEN_AI, OPEN_HS, EWS_AI, SC_AI, ST_AI, OPEN
 *   - invalid reservation example: OBC_NCL_AI (INVALID_RESERVATION_CATEGORY_CODE)
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';
const V2_PATH = '/api/nw_college_predictor/colleges/get/v2/';

function getToken() {
  return process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
}

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

function outboundBody(inner) {
  return useLegacyWrappedPayload() ? wrapLegacy(inner) : inner;
}

function baseInner(examEnum, reservationCode, admission = 'DEFAULT', overrides = {}) {
  return {
    entrance_exam_name_enum: examEnum,
    admission_category_name_enum: admission,
    cutoff_from: 74,
    cutoff_to: 500000,
    reservation_category_code: reservationCode,
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
    ...overrides,
  };
}

async function post(path, inner, limit = 2) {
  const token = getToken();
  if (!token || !String(token).trim()) {
    return { skip: true, reason: 'Missing COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN' };
  }
  const url = `${BASE_URL}${path}?offset=0&limit=${encodeURIComponent(limit)}`;
  const res = await axios.post(url, outboundBody(inner), {
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
    response: d.response,
    total: d.total_no_of_colleges,
    sample: Array.isArray(d.colleges) ? d.colleges.length : 0,
  };
}

function printResult(prefix, r) {
  if (r.skip) {
    console.log(prefix, 'SKIP', r.reason);
    return;
  }
  console.log(
    prefix,
    `HTTP ${r.status} ok=${r.ok} res_status=${r.res_status || '-'} total=${r.total ?? '-'} sample=${r.sample ?? '-'}`
  );
  if (!r.ok && r.response) {
    console.log('   ', String(r.response).slice(0, 160));
  }
}

async function runMain() {
  console.log('Base URL:', BASE_URL);
  console.log('POST body mode:', useLegacyWrappedPayload() ? 'legacy wrapped' : 'openapi flat');

  const examCandidates = [
    'JEE',
    'JEE_MAIN',
    'JEE_ADVANCED',
    'JEE_MAIN_2024',
    'JEE_MAINS_2024',
    'JEE_ADVANCE_2024',
    'JEE_ADVANCED_2024',
  ];

  console.log('\n--- Exam enum matrix (DEFAULT + OPEN_AI) ---');
  for (const exam of examCandidates) {
    const r = await post(V1_PATH, baseInner(exam, 'OPEN_AI', 'DEFAULT'));
    printResult(`${exam.padEnd(18)}`, r);
  }

  const workingExams = ['JEE_MAINS_2024', 'JEE_ADVANCE_2024'];
  const admissions = ['DEFAULT', 'GENERAL', 'MAIN', 'ADVANCED'];

  for (const exam of workingExams) {
    console.log(`\n--- Admission matrix (${exam}) with OPEN_AI ---`);
    for (const adm of admissions) {
      const r = await post(V1_PATH, baseInner(exam, 'OPEN_AI', adm));
      printResult(`adm=${adm.padEnd(9)}`, r);
    }
  }

  const reservations = ['OPEN_AI', 'OPEN_HS', 'EWS_AI', 'SC_AI', 'ST_AI', 'OPEN', 'OBC_NCL_AI', 'INVALID_CAT'];
  for (const exam of workingExams) {
    console.log(`\n--- Reservation matrix (${exam}) with admission DEFAULT ---`);
    for (const code of reservations) {
      const r = await post(V1_PATH, baseInner(exam, code, 'DEFAULT'));
      printResult(`res=${code.padEnd(12)}`, r);
    }
  }
}

async function runMatrix() {
  console.log('\n=== --matrix: branches, districts, sort_order, v2 ===');
  const exam = 'JEE_MAINS_2024';
  const admission = 'DEFAULT';
  const reservation = 'OPEN_AI';

  let r = await post(V1_PATH, baseInner(exam, reservation, admission, { branch_codes: [] }));
  printResult('v1 branch []              ', r);

  r = await post(V1_PATH, baseInner(exam, reservation, admission, { branch_codes: ['CSE'] }));
  printResult('v1 branch [CSE]           ', r);

  r = await post(V1_PATH, baseInner(exam, reservation, admission, { districts: [] }));
  printResult('v1 districts []           ', r);

  r = await post(V1_PATH, baseInner(exam, reservation, admission, { districts: ['Hyderabad'] }));
  printResult('v1 districts [Hyderabad]  ', r);

  r = await post(V1_PATH, baseInner(exam, reservation, admission, { sort_order: 'DESC' }));
  printResult('v1 sort DESC              ', r);

  r = await post(V1_PATH, baseInner(exam, reservation, admission, { sort_order: 'BAD' }));
  printResult('v1 sort BAD               ', r);

  const v2Inner = {
    entrance_exam_name_enum: exam,
    admission_category_name_enum: admission,
    cutoff_from: 74,
    cutoff_to: 500000,
    reservation_category_codes: ['OPEN_AI', 'SC_AI'],
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  };
  r = await post(V2_PATH, v2Inner);
  printResult('v2 reservation codes      ', r);
}

async function main() {
  const token = getToken();
  if (!token || !String(token).trim()) {
    console.error('Missing COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN');
    process.exit(1);
  }

  await runMain();
  if (process.argv.includes('--matrix')) {
    await runMatrix();
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
