/**
 * Probe earlywave WBJEE predictor enum compatibility.
 *
 * Usage: node scripts/probeWbjeePredictor.js
 *
 * Verified (beta): entrance_exam_name_enum **WBJEE_2024** with admission **DEFAULT**
 * and reservations OPEN_AI, OPEN_HS, OBC_A_HS, etc. CollegeDost form may use
 * WBJEE_JEE_MAINS_2024 — that enum is INVALID on nw-predictors; use WBJEE_2024.
 *
 * Requires: COLLEGEDOST_ACCESS_TOKEN or NW_PREDICTORS_ACCESS_TOKEN
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';

function getToken() {
  return process.env.COLLEGEDOST_ACCESS_TOKEN || process.env.NW_PREDICTORS_ACCESS_TOKEN;
}

function useLegacyWrappedPayload() {
  if (String(process.env.NW_PREDICTORS_USE_OPENAPI_FLAT_BODY || '').trim() === 'true') return false;
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

function rankToCutoff(rank) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return [0, 0];
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
  return [Math.max(1, r - buffer), 500000];
}

function baseInner(examEnum, reservationCode, admission = 'DEFAULT') {
  return {
    entrance_exam_name_enum: examEnum,
    admission_category_name_enum: admission,
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_code: reservationCode,
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  };
}

async function post(inner, limit = 5) {
  const token = getToken();
  const url = `${BASE_URL}${V1_PATH}?offset=0&limit=${encodeURIComponent(limit)}`;
  const res = await axios.post(url, outboundBody(inner), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    timeout: 25000,
    validateStatus: () => true,
  });
  const d = res.data || {};
  return { status: res.status, ok: res.status >= 200 && res.status < 300, res_status: d.res_status, response: d.response, total: d.total_no_of_colleges };
}

async function main() {
  const token = getToken();
  if (!token) {
    console.error('Missing token');
    process.exit(1);
  }
  console.log('Base URL:', BASE_URL);
  const exams = ['WBJEE_JEE_MAINS_2024', 'WBJEE_2024', 'WBJEE_2025', 'WBJEE'];
  const reservations = ['OPEN_AI', 'OPEN_HS', 'OBC_A_HS', 'OBC_B_HS', 'SC_HS', 'ST_HS'];

  for (const exam of exams) {
    console.log('\n---', exam, '---');
    for (const adm of ['DEFAULT', 'GENERAL']) {
      const r = await post({ ...baseInner(exam, 'OPEN_AI', adm) });
      console.log(`  adm ${adm}: HTTP ${r.status} ok=${r.ok} res=${r.res_status} total=${r.total}`, r.ok ? '' : String(r.response).slice(0, 80));
    }
    for (const resCode of reservations) {
      const r = await post(baseInner(exam, resCode, 'DEFAULT'));
      console.log(`  res ${resCode}: HTTP ${r.status} ok=${r.ok} total=${r.total}`, r.ok ? '' : String(r.response).slice(0, 80));
    }
  }

  // --- Base codes (no _HS/_AI suffix) vs. suffixed codes comparison ---
  const baseCodes = ['OPEN', 'OBC_A', 'OBC_B', 'SC', 'ST', 'TUITION_FEE_WAIVER'];
  const suffixedCodes = ['OPEN_HS', 'OPEN_AI', 'OBC_A_HS', 'OBC_B_HS', 'SC_HS', 'ST_HS', 'TUITION_FEE_WAIVER_HS', 'ST_AI'];

  console.log('\n--- BASE codes (no suffix) vs SUFFIXED codes (WBJEE_2024, DEFAULT, wide cutoff) ---');
  console.log('Base codes:');
  for (const code of baseCodes) {
    const r = await post(baseInner('WBJEE_2024', code, 'DEFAULT'), 5);
    console.log(`  ${code.padEnd(22)}: HTTP ${r.status} ok=${r.ok} total=${r.total}`, r.ok ? '' : String(r.response).slice(0, 80));
  }
  console.log('Suffixed codes:');
  for (const code of suffixedCodes) {
    const r = await post(baseInner('WBJEE_2024', code, 'DEFAULT'), 5);
    console.log(`  ${code.padEnd(22)}: HTTP ${r.status} ok=${r.ok} total=${r.total}`, r.ok ? '' : String(r.response).slice(0, 80));
  }

  // --- Realistic scenario with rank 2323 ---
  const [cutoffFrom, cutoffTo] = rankToCutoff(2323);
  console.log('\n--- realistic matrix (WBJEE_2024, rank 2323) ---');
  const realisticBase = {
    ...baseInner('WBJEE_2024', 'OPEN', 'DEFAULT'),
    cutoff_from: cutoffFrom,
    cutoff_to: cutoffTo,
  };
  const baseOpen = await post({ ...realisticBase }, 20);
  console.log(
    `  OPEN (base), districts []: HTTP ${baseOpen.status} ok=${baseOpen.ok} total=${baseOpen.total}`
  );
  const suffixedOpen = await post({ ...realisticBase, reservation_category_code: 'OPEN_HS' }, 20);
  console.log(
    `  OPEN_HS,    districts []: HTTP ${suffixedOpen.status} ok=${suffixedOpen.ok} total=${suffixedOpen.total}`
  );
  const bankura = await post({ ...realisticBase, districts: ['Bankura'] }, 20);
  console.log(
    `  OPEN (base), Bankura   : HTTP ${bankura.status} ok=${bankura.ok} total=${bankura.total}`
  );

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
