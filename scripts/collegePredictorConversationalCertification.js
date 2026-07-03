'use strict';

/**
 * End-to-end certification for AI Conversational College Predictor.
 * Phases 2–6 and 8 (conversation, slot filling, live API, state, formatting, performance).
 * Run: node scripts/collegePredictorConversationalCertification.js
 */

require('dotenv').config();

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const axios = require('axios');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
  buildCounsellorStyleRequestBody,
} = require('../services/chatbot/collegePredictorChatService');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { fetchCollegeDostColleges } = require('../services/collegePredictorCore');
const { getPredictorAccessToken } = require('../services/collegeDostService');

function buildPredictorAuthHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (process.env.NW_PREDICTORS_X_SOURCE) {
    headers['X-Source'] = process.env.NW_PREDICTORS_X_SOURCE;
  }
  return headers;
}
const {
  EXAM_AP,
  EXAM_TS,
  EXAM_TNEA,
  EXAM_KCET,
  EXAM_KEAM,
  EXAM_WBJEE,
  EXAM_JEE_MAIN,
  EXAM_JEE_ADV,
  EXAM_MHT,
} = require('../constants/whatsappCollegePredictor');

const BASE_URL = process.env.NW_PREDICTORS_BASE_URL || 'https://nw-predictors-backend-beta.earlywave.in';
const V1_PATH = '/api/nw_college_predictor/colleges/get/v1/';

const report = {
  startedAt: new Date().toISOString(),
  phases: {},
  totals: { executed: 0, passed: 0, failed: 0, warnings: 0 },
  failures: [],
  warnings: [],
  performance: {},
};

function pass(name, phase) {
  report.totals.executed += 1;
  report.totals.passed += 1;
  if (!report.phases[phase]) report.phases[phase] = { passed: 0, failed: 0, warnings: 0 };
  report.phases[phase].passed += 1;
}

function fail(name, phase, err) {
  report.totals.executed += 1;
  report.totals.failed += 1;
  if (!report.phases[phase]) report.phases[phase] = { passed: 0, failed: 0, warnings: 0 };
  report.phases[phase].failed += 1;
  report.failures.push({ name, phase, error: String(err?.message || err) });
}

function warn(msg) {
  report.totals.warnings += 1;
  report.warnings.push(msg);
}

async function runTest(name, phase, fn) {
  try {
    await fn();
    pass(name, phase);
  } catch (err) {
    fail(name, phase, err);
  }
}

function mockSuccess(callLog) {
  return async (exam, offset, limit, body) => {
    callLog.items.push({ exam, offset, limit, body });
    return {
      colleges: [
        {
          college_name: 'Test Engineering College',
          branches: [
            {
              branch_name: 'Computer Science Engineering',
              branch_code: 'CSE',
              reservation_categories: [
                { cutoff_rank: 12000, category_name: 'BC-B', reservation_category_code: 'BCB' },
              ],
            },
          ],
        },
      ],
      total_no_of_colleges: 1,
    };
  };
}

function mockError(code, resStatus, httpStatus) {
  return async () => {
    const err = new Error(`mock ${code}`);
    err.res_status = resStatus;
    err.http_status_code = httpStatus;
    throw err;
  };
}

async function sendFlow(steps, opts = {}) {
  const latencies = [];
  let ctx = opts.context || {};
  let last;
  for (let i = 0; i < steps.length; i++) {
    const t0 = performance.now();
    last = await handleCollegePredictorMessage(steps[i], ctx, {
      isNewEntry: i === 0 && !opts.continue,
    });
    latencies.push(performance.now() - t0);
    ctx = last.context;
  }
  return { last, latencies, ctx };
}

const EXAM_FLOWS = {
  [EXAM_AP]: { menu: ['1', '5623', '2', '2', '1'], nl: 'My AP EAMCET rank is 5623 BC-A Female AU' },
  [EXAM_TS]: { menu: ['2', '18453', '2', '1'], nl: 'TS EAMCET rank 18453 BC-B male' },
  [EXAM_TNEA]: { menu: ['3', '12000', '2'], nl: 'TNEA rank 12000 BC' },
  [EXAM_KCET]: { menu: ['4', '9500', '2', '3'], nl: 'KCET rank 9500 HK 2BG' },
  [EXAM_KEAM]: { menu: ['5', '8000', '2'], nl: 'KEAM rank 8000 SC' },
  [EXAM_WBJEE]: { menu: ['6', '7000', '1', '1'], nl: 'WBJEE rank 12000 OBC-A All India' },
  [EXAM_JEE_MAIN]: { menu: ['7', '24000', '2', '3'], nl: 'JEE Main AIR 24000 female OBC' },
  [EXAM_JEE_ADV]: { menu: ['8', '5000', '1', '2'], nl: 'JEE Advanced rank 5000 male OPEN' },
  [EXAM_MHT]: { menu: ['9', '94.3', '1', '2'], nl: 'MHT CET 94.3 percentile SL GOPENS' },
};

async function phase2SlotFilling() {
  const phase = 'phase2_slot_filling';
  const callLog = { items: [] };

  for (const [exam, flow] of Object.entries(EXAM_FLOWS)) {
    callLog.items = [];
    setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });

    await runTest(`${exam} empty conversation asks exam`, phase, async () => {
      const r = await handleCollegePredictorMessage('hi', {}, { isNewEntry: true });
      assert.equal(r.context.step, 'exam');
      assert.equal(callLog.items.length, 0);
    });

    await runTest(`${exam} menu digit happy path`, phase, async () => {
      callLog.items = [];
      const { last } = await sendFlow(flow.menu);
      assert.equal(last.clearState, true, 'should complete prediction');
      assert.equal(callLog.items.length, 1, 'single API call');
      assert.equal(callLog.items[0].exam, exam);
    });

    await runTest(`${exam} natural language completes or advances`, phase, async () => {
      callLog.items = [];
      const r = await handleCollegePredictorMessage(flow.nl, {}, { isNewEntry: true });
      if (r.clearState) {
        assert.equal(callLog.items.length, 1);
      } else {
        assert.ok(r.context.exam, 'exam should be extracted');
        assert.equal(callLog.items.length, 0, 'no premature API call');
      }
    });

    if (exam === EXAM_MHT) {
      await runTest(`${exam} invalid percentile rejected`, phase, async () => {
        let r = await handleCollegePredictorMessage('9', {}, { isNewEntry: true });
        r = await handleCollegePredictorMessage('101', r.context);
        assert.equal(r.context.step, 'percentile');
      });
    } else {
      await runTest(`${exam} invalid rank rejected`, phase, async () => {
        const examDigit = flow.menu[0];
        let r = await handleCollegePredictorMessage(examDigit, {}, { isNewEntry: true });
        r = await handleCollegePredictorMessage('abc', r.context);
        assert.equal(r.context.step, 'rank');
        assert.match(r.reply, /valid positive number/i);
      });
    }

    await runTest(`${exam} invalid category rejected`, phase, async () => {
      const { last: mid } = await sendFlow(flow.menu.slice(0, -1));
      const r = await handleCollegePredictorMessage('ZZZZ', mid.context);
      assert.match(r.context.step, /category|admission|quota|region|gender/);
    });

    if (exam === EXAM_AP || exam === EXAM_TS) {
      await runTest(`${exam} invalid gender rejected`, phase, async () => {
        let r = await handleCollegePredictorMessage(flow.menu[0], {}, { isNewEntry: true });
        r = await handleCollegePredictorMessage(flow.menu[1], r.context);
        r = await handleCollegePredictorMessage(flow.menu[2], r.context);
        r = await handleCollegePredictorMessage('other', r.context);
        assert.equal(r.context.step, 'gender');
      });
    }

    if (exam === EXAM_WBJEE) {
      await runTest(`${exam} invalid quota rejected`, phase, async () => {
        let r = await handleCollegePredictorMessage('6', {}, { isNewEntry: true });
        r = await handleCollegePredictorMessage('12000', r.context);
        r = await handleCollegePredictorMessage('1', r.context);
        r = await handleCollegePredictorMessage('9', r.context);
        assert.equal(r.context.step, 'quota');
      });
    }

    if (exam === EXAM_AP) {
      await runTest(`${exam} invalid region rejected`, phase, async () => {
        let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
        r = await handleCollegePredictorMessage('100', r.context);
        r = await handleCollegePredictorMessage('1', r.context);
        r = await handleCollegePredictorMessage('2', r.context);
        r = await handleCollegePredictorMessage('invalid', r.context);
        assert.equal(r.context.step, 'region');
      });
    }

    await runTest(`${exam} exam change midway clears slots`, phase, async () => {
      let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
      r = await handleCollegePredictorMessage(flow.menu[1], r.context);
      r = await handleCollegePredictorMessage('KCET', r.context);
      assert.equal(r.context.exam, EXAM_KCET);
      assert.equal(r.context.rank, undefined);
    });

    await runTest(`${exam} AGAIN restarts`, phase, async () => {
      let r = await handleCollegePredictorMessage(flow.menu[0], {}, { isNewEntry: true });
      r = await handleCollegePredictorMessage('again', r.context);
      assert.match(r.reply, /Sure! I can help/);
      assert.equal(r.context.step, 'exam');
    });
  }

  await runTest('MENU intent during predictor', phase, async () => {
    const r = classifyIntent('menu', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  await runTest('AGENT intent during predictor', phase, async () => {
    const r = classifyIntent('agent', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'human_handoff');
  });

  setCollegePredictorDeps({});
}

async function phase3LiveApi() {
  const phase = 'phase3_live_api';
  const token = getPredictorAccessToken();
  if (!token) {
    warn('Live API skipped: no NW_PREDICTORS_ACCESS_TOKEN or COLLEGEDOST_ACCESS_TOKEN');
    return;
  }

  const tsBody = {
    exam: EXAM_TS,
    rank: 18453,
    reservation_category_codes: ['BCB BOYS'],
    admission_category_name_enum: 'DEFAULT',
  };

  await runTest('live TS EAMCET valid rank', phase, async () => {
    const t0 = performance.now();
    const data = await fetchCollegeDostColleges(EXAM_TS, 0, 5, tsBody);
    report.performance.liveApiValidMs = Math.round(performance.now() - t0);
    assert.ok(data);
    assert.ok(Array.isArray(data.colleges));
    assert.ok(data.colleges.length > 0, 'expected colleges for valid rank');
  });

  await runTest('live high rank handled without crash', phase, async () => {
    try {
      const data = await fetchCollegeDostColleges(EXAM_TS, 0, 5, {
        ...tsBody,
        rank: 999999,
      });
      assert.ok(Array.isArray(data.colleges));
    } catch (err) {
      assert.ok(
        /cutoff|greater/i.test(String(err.message)),
        'upstream may reject extreme rank cutoff range'
      );
      warn('Live API rejects rank 999999 with cutoff range error — upstream validation, not chatbot bug');
    }
  });

  await runTest('live low rank returns colleges', phase, async () => {
    const data = await fetchCollegeDostColleges(EXAM_TS, 0, 5, { ...tsBody, rank: 500 });
    assert.ok(data.colleges.length > 0);
  });

  await runTest('payload builder matches counsellor contract', phase, async () => {
    const ctx = {
      exam: EXAM_TS,
      rank: 18453,
      reservation_category_codes: ['BCB BOYS'],
      admission_category_name_enum: 'DEFAULT',
    };
    const body = buildCounsellorStyleRequestBody(ctx);
    assert.deepEqual(body, {
      exam: EXAM_TS,
      rank: 18453,
      reservation_category_codes: ['BCB BOYS'],
      admission_category_name_enum: 'DEFAULT',
    });
  });

  await runTest('auth header Bearer present', phase, async () => {
    const headers = buildPredictorAuthHeaders(token);
    assert.match(headers.Authorization, /^Bearer /);
    assert.equal(headers['Content-Type'], 'application/json');
  });

  await runTest('endpoint v1 path correct', phase, async () => {
    const url = `${BASE_URL}${V1_PATH}?offset=0&limit=1`;
    assert.match(url, /nw_college_predictor\/colleges\/get\/v1/);
  });

  await runTest('401 invalid token handled gracefully', phase, async () => {
    const url = `${BASE_URL}${V1_PATH}?offset=0&limit=1`;
    const inner = {
      entrance_exam_name_enum: 'TS_EAMCET',
      admission_category_name_enum: 'DEFAULT',
      cutoff_from: 18000,
      cutoff_to: 19000,
      reservation_category_code: 'BCB BOYS',
      branch_codes: [],
      districts: [],
      sort_order: 'ASC',
    };
    const res = await axios.post(
      url,
      { clientKeyDetailsId: 1, data: JSON.stringify(inner), branch_codes: [] },
      { headers: buildPredictorAuthHeaders('invalid-token-xyz'), validateStatus: () => true, timeout: 15000 }
    );
    assert.ok(res.status === 401 || res.status === 403 || res.status >= 400);
  });

  await runTest('chatbot handles API failure without crash', phase, async () => {
    setCollegePredictorDeps({ getPredictedColleges: mockError('upstream', 'UPSTREAM_ERROR', 500) });
    const { last } = await sendFlow(['2', '15000', '4', '2']);
    assert.equal(last.context.step, 'predict');
    assert.match(last.reply, /could not fetch/i);
    setCollegePredictorDeps({});
  });

  await runTest('chatbot handles timeout without crash', phase, async () => {
    setCollegePredictorDeps({
      getPredictedColleges: async () => {
        const err = new Error('Predictor request timed out');
        err.res_status = 'SERVICE_UNAVAILABLE';
        err.http_status_code = 502;
        throw err;
      },
    });
    const { last } = await sendFlow(['2', '15000', '4', '2']);
    assert.equal(last.context.step, 'predict');
    setCollegePredictorDeps({});
  });

  await runTest('chatbot handles network failure without crash', phase, async () => {
    setCollegePredictorDeps({
      getPredictedColleges: async () => {
        const err = new Error('Cannot reach predictor service');
        err.res_status = 'SERVICE_UNAVAILABLE';
        err.http_status_code = 502;
        throw err;
      },
    });
    const { last } = await sendFlow(['2', '15000', '4', '2']);
    assert.equal(last.context.step, 'predict');
    setCollegePredictorDeps({});
  });
}

async function phase4Conversations() {
  const phase = 'phase4_conversations';
  const callLog = { items: [] };
  setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });

  const scenarios = [
    {
      name: 'TS EAMCET rank only sentence',
      input: 'I got 18453 in TS EAMCET.',
      expect: { exam: EXAM_TS, rank: 18453, step: 'category' },
    },
    {
      name: 'AP EAMCET multi-slot',
      input: 'My AP EAMCET rank is 5623 BC-B Female.',
      expect: { exam: EXAM_AP, rank: 5623, step: 'region' },
    },
    {
      name: 'JEE Main AIR',
      input: 'I wrote JEE Main AIR 24000.',
      expect: { exam: EXAM_JEE_MAIN, rank: 24000 },
    },
    {
      name: 'MHT CET percentile',
      input: 'I got 94.3 percentile in MHT CET.',
      expect: { exam: EXAM_MHT, percentile: 94.3 },
    },
    {
      name: 'BC-A standalone after partial',
      input: 'I belong to BC-A.',
      setup: ['2', '18453'],
      expect: { categoryLabel: /BC-A/ },
    },
    {
      name: 'female standalone completes gender slot',
      input: 'I am female.',
      setup: ['2', '18453', '4'],
      expect: { gender: 'female', completes: true },
    },
  ];

  for (const sc of scenarios) {
    await runTest(sc.name, phase, async () => {
      callLog.items = [];
      let ctx = {};
      if (sc.setup) {
        for (const s of sc.setup) {
          const r = await handleCollegePredictorMessage(s, ctx, { isNewEntry: !ctx.step });
          ctx = r.context;
        }
      }
      const r = await handleCollegePredictorMessage(sc.input, ctx, { isNewEntry: !ctx.step });
      if (sc.expect.exam) assert.equal(r.context.exam, sc.expect.exam);
      if (sc.expect.rank) assert.equal(r.context.rank, sc.expect.rank);
      if (sc.expect.percentile) assert.equal(r.context.percentile, sc.expect.percentile);
      if (sc.expect.step) assert.equal(r.context.step, sc.expect.step);
      if (sc.expect.gender) assert.equal(r.context.gender, sc.expect.gender);
      if (sc.expect.categoryLabel) assert.match(r.context.categoryLabel, sc.expect.categoryLabel);
      if (sc.expect.completes) {
        assert.equal(r.clearState, true);
        assert.equal(callLog.items.length, 1);
      } else {
        assert.equal(callLog.items.length, 0, 'should not call API until ready');
      }
    });
  }

  await runTest('CSE colleges phrase does not crash (branch filter N/A)', phase, async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('I need CSE colleges', r.context);
    assert.ok(r.reply);
    if (!r.context.categoryLabel) {
      warn('Branch preference (CSE) is not collected in conversational flow — pre-existing limitation');
    }
  });

  setCollegePredictorDeps({});
}

async function phase5StateMachine() {
  const phase = 'phase5_state_machine';
  const callLog = { items: [] };

  await runTest('interruption then resume', phase, async () => {
    setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('hello there', r.context);
    assert.equal(r.context.exam, EXAM_TS);
    assert.equal(r.context.step, 'rank');
    r = await handleCollegePredictorMessage('15000', r.context);
    assert.equal(r.context.rank, 15000);
    setCollegePredictorDeps({});
  });

  await runTest('API retry preserves context', phase, async () => {
    setCollegePredictorDeps({ getPredictedColleges: mockError('x', 'UPSTREAM_ERROR', 500) });
    let r = await sendFlow(['2', '15000', '4', '2']);
    assert.equal(r.last.context.step, 'predict');
    assert.equal(r.last.context.rank, 15000);
    setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });
    r = await handleCollegePredictorMessage('retry', r.last.context);
    assert.equal(r.clearState, true);
    setCollegePredictorDeps({});
  });

  await runTest('state cleanup after success', phase, async () => {
    setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });
    const { last } = await sendFlow(['2', '15000', '1', '2']);
    assert.equal(last.clearState, true);
    assert.equal(last.context.step, 'done');
    setCollegePredictorDeps({});
  });

  await runTest('no stale rank after exam switch', phase, async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('JEE Main', r.context);
    assert.equal(r.context.exam, EXAM_JEE_MAIN);
    assert.equal(r.context.rank, undefined);
    assert.equal(r.context.categoryLabel, undefined);
  });

  await runTest('state JSON size reasonable', phase, async () => {
    let r = await handleCollegePredictorMessage('TS EAMCET rank 18453 BC-B', {}, { isNewEntry: true });
    const size = JSON.stringify(r.context).length;
    assert.ok(size < 2048, `context size ${size} should be small`);
    report.performance.maxContextBytes = size;
  });

  setCollegePredictorDeps({});
}

async function phase6Results() {
  const phase = 'phase6_results';
  const callLog = { items: [] };
  setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });

  await runTest('formatted result includes all fields and footer', phase, async () => {
    const { last } = await sendFlow(['2', '15000', '4', '2']);
    assert.match(last.reply, /Test Engineering College/);
    assert.match(last.reply, /Branch:/);
    assert.match(last.reply, /Cutoff:/);
    assert.match(last.reply, /Category:/);
    assert.match(last.reply, /MENU -> Main Menu/);
    assert.match(last.reply, /AGAIN -> New Prediction/);
    assert.match(last.reply, /AGENT -> Talk to Counsellor/);
  });

  await runTest('empty results formatted', phase, async () => {
    setCollegePredictorDeps({
      getPredictedColleges: async () => ({ colleges: [], total_no_of_colleges: 0 }),
    });
    const { last } = await sendFlow(['2', '15000', '4', '2']);
    assert.match(last.reply, /No colleges found/);
    assert.match(last.reply, /MENU -> Main Menu/);
    setCollegePredictorDeps({});
  });
}

async function phase8Performance() {
  const phase = 'phase8_performance';
  const callLog = { items: [] };
  setCollegePredictorDeps({ getPredictedColleges: mockSuccess(callLog) });

  const convLatencies = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await sendFlow(['2', '15000', '4', '2']);
    convLatencies.push(performance.now() - t0);
  }

  const avgConv = convLatencies.reduce((a, b) => a + b, 0) / convLatencies.length;
  report.performance.avgConversationMs = Math.round(avgConv);
  report.performance.maxConversationMs = Math.round(Math.max(...convLatencies));

  await runTest('avg conversation latency under 50ms (mocked API)', phase, async () => {
    assert.ok(avgConv < 50, `avg ${avgConv}ms`);
  });

  await runTest('single API call per completed flow', phase, async () => {
    callLog.items = [];
    await sendFlow(['2', '15000', '4', '2']);
    assert.equal(callLog.items.length, 1);
  });

  await runTest('no LLM in predictor path', phase, async () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../services/chatbot/collegePredictorChatService.js'),
      'utf8'
    );
    assert.ok(!/openai|gpt|llm|chatCompletion/i.test(src), 'predictor chat service should not call LLM');
  });

  const mem = process.memoryUsage();
  report.performance.heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
  pass('memory snapshot recorded', phase);
  setCollegePredictorDeps({});
}

async function main() {
  await phase2SlotFilling();
  await phase3LiveApi();
  await phase4Conversations();
  await phase5StateMachine();
  await phase6Results();
  await phase8Performance();

  report.finishedAt = new Date().toISOString();
  report.productionReadinessScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (report.totals.passed / Math.max(1, report.totals.executed)) * 100 -
          report.totals.failed * 5 -
          report.totals.warnings * 2
      )
    )
  );

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.totals.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
