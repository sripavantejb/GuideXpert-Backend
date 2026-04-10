/**
 * Test the local backend WBJEE college predictor with diverse payloads.
 *
 * Usage: node scripts/probeWbjeeLocal.js [port]
 *
 * Requires the backend server to be running (default http://localhost:5000).
 * Tests base reservation codes, quota-based suffixing, rank-to-cutoff
 * conversion, and edge cases.
 */

const axios = require('axios');

const PORT = process.argv[2] || process.env.PORT || 5000;
const BASE = `http://localhost:${PORT}/api/college-predictor/colleges`;

let passed = 0;
let failed = 0;

async function post(body, offset = 0, limit = 5) {
  const url = `${BASE}?offset=${offset}&limit=${limit}`;
  try {
    const res = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    return { status: 0, data: { response: err.message } };
  }
}

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function main() {
  console.log(`Testing WBJEE predictor against ${BASE}\n`);

  // 1. Suffixed reservation code with cutoffs (baseline — should work)
  console.log('--- 1. Baseline: suffixed code + cutoffs ---');
  const r1 = await post({
    exam: 'WBJEE',
    entrance_exam_name_enum: 'WBJEE_2024',
    admission_category_name_enum: 'DEFAULT',
    cutoff_from: 299,
    cutoff_to: 500000,
    reservation_category_codes: ['OBC_A_HS'],
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  });
  assert('HTTP 200', r1.status === 200, `got ${r1.status}: ${JSON.stringify(r1.data?.response || r1.data?.res_status || '').slice(0, 120)}`);
  assert('has colleges array', Array.isArray(r1.data?.colleges), '');
  assert('total_no_of_colleges >= 0', typeof r1.data?.total_no_of_colleges === 'number', `got ${r1.data?.total_no_of_colleges}`);

  // 2. Base reservation code (OBC_A) + Home State quota — backend should suffix to OBC_A_HS
  console.log('\n--- 2. Base code OBC_A + home_state_wb quota ---');
  const r2 = await post({
    exam: 'WBJEE',
    entrance_exam_name_enum: 'WBJEE_2024',
    admission_category_name_enum: 'DEFAULT',
    cutoff_from: 299,
    cutoff_to: 500000,
    reservation_category_codes: ['OBC_A'],
    quota: 'home_state_wb',
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  });
  assert('HTTP 200', r2.status === 200, `got ${r2.status}: ${JSON.stringify(r2.data?.response || r2.data?.res_status || '').slice(0, 120)}`);

  // 3. Base code (OPEN) + All India quota — should resolve to OPEN_AI
  console.log('\n--- 3. Base code OPEN + all_india quota ---');
  const r3 = await post({
    exam: 'WBJEE',
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_codes: ['OPEN'],
    quota: 'all_india',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r3.status === 200, `got ${r3.status}: ${JSON.stringify(r3.data?.response || r3.data?.res_status || '').slice(0, 120)}`);

  // 4. Rank-based (no cutoffs) — should auto-derive cutoffs from wbjee_rank
  console.log('\n--- 4. Rank-based: wbjee_rank=349 (no cutoff fields) ---');
  const r4 = await post({
    exam: 'WBJEE',
    wbjee_rank: 349,
    reservation_category_codes: ['OPEN_HS'],
    sort_order: 'ASC',
  });
  assert('HTTP 200', r4.status === 200, `got ${r4.status}: ${JSON.stringify(r4.data?.response || r4.data?.res_status || '').slice(0, 120)}`);
  assert('has colleges', Array.isArray(r4.data?.colleges), '');

  // 5. Rank-based with jee_main_rank fallback
  console.log('\n--- 5. Rank-based: jee_main_rank=8778 (no wbjee_rank) ---');
  const r5 = await post({
    exam: 'WBJEE',
    jee_main_rank: 8778,
    reservation_category_codes: ['OPEN_AI'],
    sort_order: 'ASC',
  });
  assert('HTTP 200', r5.status === 200, `got ${r5.status}: ${JSON.stringify(r5.data?.response || r5.data?.res_status || '').slice(0, 120)}`);

  // 6. Combined: rank + base code + quota
  console.log('\n--- 6. Combined: wbjee_rank=349, base code OBC_A, home_state_wb ---');
  const r6 = await post({
    exam: 'WBJEE',
    wbjee_rank: 349,
    reservation_category_codes: ['OBC_A'],
    quota: 'home_state_wb',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r6.status === 200, `got ${r6.status}: ${JSON.stringify(r6.data?.response || r6.data?.res_status || '').slice(0, 120)}`);

  // 7. WBJEE_JEE_MAINS_2024 enum (should be mapped to WBJEE_2024 by backend)
  console.log('\n--- 7. Exam enum WBJEE_JEE_MAINS_2024 ---');
  const r7 = await post({
    exam: 'WBJEE_JEE_MAINS_2024',
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_codes: ['OPEN_AI'],
    sort_order: 'ASC',
  });
  assert('HTTP 200', r7.status === 200, `got ${r7.status}: ${JSON.stringify(r7.data?.response || r7.data?.res_status || '').slice(0, 120)}`);

  // 8. Empty reservation — should default to OPEN_AI
  console.log('\n--- 8. Empty reservation codes (default to OPEN_AI) ---');
  const r8 = await post({
    exam: 'WBJEE',
    cutoff_from: 1,
    cutoff_to: 500000,
    sort_order: 'ASC',
  });
  assert('HTTP 200', r8.status === 200, `got ${r8.status}: ${JSON.stringify(r8.data?.response || r8.data?.res_status || '').slice(0, 120)}`);

  // 9. Home-state-only base (TUITION_FEE_WAIVER) + All India — should gracefully fall back to OPEN_AI
  console.log('\n--- 9. Edge: TUITION_FEE_WAIVER + all_india (invalid combo -> OPEN_AI fallback) ---');
  const r9 = await post({
    exam: 'WBJEE',
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_codes: ['TUITION_FEE_WAIVER'],
    quota: 'all_india',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r9.status === 200, `got ${r9.status}: ${JSON.stringify(r9.data?.response || r9.data?.res_status || '').slice(0, 120)}`);

  // 10. TUITION_FEE_WAIVER + Home State — should resolve to TUITION_FEE_WAIVER_HS
  console.log('\n--- 10. TUITION_FEE_WAIVER + home_state_wb ---');
  const r10 = await post({
    exam: 'WBJEE',
    cutoff_from: 1,
    cutoff_to: 500000,
    reservation_category_codes: ['TUITION_FEE_WAIVER'],
    quota: 'home_state_wb',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r10.status === 200, `got ${r10.status}: ${JSON.stringify(r10.data?.response || r10.data?.res_status || '').slice(0, 120)}`);

  // 11. PwD category + Home State
  console.log('\n--- 11. OPEN_PWD + home_state_wb ---');
  const r11 = await post({
    exam: 'WBJEE',
    wbjee_rank: 1000,
    reservation_category_codes: ['OPEN_PWD'],
    quota: 'home_state_wb',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r11.status === 200, `got ${r11.status}: ${JSON.stringify(r11.data?.response || r11.data?.res_status || '').slice(0, 120)}`);

  // 12. No rank and no cutoffs — should return 400
  console.log('\n--- 12. Error case: no rank and no cutoffs ---');
  const r12 = await post({
    exam: 'WBJEE',
    reservation_category_codes: ['OPEN_AI'],
    sort_order: 'ASC',
  });
  assert('HTTP 400', r12.status === 400, `got ${r12.status}`);

  // 13. SC with home state
  console.log('\n--- 13. SC + home_state_wb ---');
  const r13 = await post({
    exam: 'WBJEE',
    wbjee_rank: 5000,
    reservation_category_codes: ['SC'],
    quota: 'home_state_wb',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r13.status === 200, `got ${r13.status}: ${JSON.stringify(r13.data?.response || r13.data?.res_status || '').slice(0, 120)}`);

  // 14. ST with All India
  console.log('\n--- 14. ST + all_india (ST_AI is in whitelist) ---');
  const r14 = await post({
    exam: 'WBJEE',
    wbjee_rank: 5000,
    reservation_category_codes: ['ST'],
    quota: 'all_india',
    sort_order: 'ASC',
  });
  assert('HTTP 200', r14.status === 200, `got ${r14.status}: ${JSON.stringify(r14.data?.response || r14.data?.res_status || '').slice(0, 120)}`);

  // 15. Quota as "Home State (West Bengal)" string (CollegeDost display format)
  console.log('\n--- 15. Quota as display string "Home State (West Bengal)" ---');
  const r15 = await post({
    exam: 'WBJEE',
    wbjee_rank: 349,
    reservation_category_codes: ['OBC_A'],
    quota: 'Home State (West Bengal)',
    sort_order: 'ASC',
  });
  assert('HTTP 200 (home state display string)', r15.status === 200, `got ${r15.status}: ${JSON.stringify(r15.data?.response || r15.data?.res_status || '').slice(0, 120)}`);

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  console.log(`========================================`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Probe error:', e.message);
  process.exit(1);
});
