'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
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
  AP_OC_MALE_BLOCKED_REPLY,
  mapExamChoice,
} = require('../constants/whatsappCollegePredictor');
const { buildConversationalWelcome } = require('../services/chatbot/whatsappCollegePredictor/collegePredictorConversation');

const MOCK_COLLEGES = {
  colleges: [
    {
      college_name: 'VNR VJIET',
      branches: [{ branch_name: 'Computer Science Engineering', branch_code: 'CSE' }],
    },
    {
      college_name: 'GRIET',
      branches: [{ branch_name: 'Information Technology', branch_code: 'IT' }],
    },
  ],
  total_no_of_colleges: 2,
};

function makeSuccessPredictor(callLog) {
  return async (exam, offset, limit, body) => {
    callLog.push({ exam, offset, limit, body });
    return { ...MOCK_COLLEGES };
  };
}

function makeFailPredictor(callLog) {
  return async (exam, offset, limit, body) => {
    callLog.push({ exam, offset, limit, body });
    const err = new Error('upstream');
    err.res_status = 'UPSTREAM_ERROR';
    throw err;
  };
}

function mockPredictorMustNotBeCalled() {
  return async () => {
    throw new Error('predictor API must not be called');
  };
}

async function runFlow(steps, context = {}) {
  let r = await handleCollegePredictorMessage(steps[0], context, { isNewEntry: true });
  for (const s of steps.slice(1)) {
    r = await handleCollegePredictorMessage(s, r.context);
  }
  return r;
}

describe('chatbotCollegePredictor', () => {
  let calls = [];

  beforeEach(() => {
    calls = [];
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
  });

  afterEach(() => {
    setCollegePredictorDeps({});
  });

  test('exam chooser maps all nine options', () => {
    assert.equal(mapExamChoice(1), EXAM_AP);
    assert.equal(mapExamChoice(2), EXAM_TS);
    assert.equal(mapExamChoice(3), EXAM_TNEA);
    assert.equal(mapExamChoice(4), EXAM_KCET);
    assert.equal(mapExamChoice(5), EXAM_KEAM);
    assert.equal(mapExamChoice(6), EXAM_WBJEE);
    assert.equal(mapExamChoice(7), EXAM_JEE_MAIN);
    assert.equal(mapExamChoice(8), EXAM_JEE_ADV);
    assert.equal(mapExamChoice(9), EXAM_MHT);
  });

  test('TS EAMCET happy path with gender', async () => {
    const r = await runFlow(['2', '15000', '4', '2']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /TS EAMCET/);
    assert.match(r.reply, /Rank\/Percentile: 15000/);
    assert.match(r.reply, /BC-C/);
    assert.match(r.reply, /Gender: Female/);
    assert.match(r.reply, /VNR VJIET/);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'DEFAULT');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'BCC GIRLS');
  });

  test('TNEA happy path', async () => {
    const r = await runFlow(['3', '12000', '2']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_TNEA);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'DEFAULT');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'BC');
  });

  test('KCET happy path with admission type then category', async () => {
    const r = await runFlow(['4', '9500', '2', '3']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_KCET);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'HK');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], '2BG');
  });

  test('KEAM happy path', async () => {
    // Menu digit "5" is College Predictor entry — choose KEAM after welcome.
    const r = await runFlow(['College predictor', '5', '5000', '2']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_KEAM);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'DEFAULT');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'EW');
  });

  test('menu digit 5 on new entry shows welcome not KEAM', async () => {
    const r = await handleCollegePredictorMessage('5', {}, { isNewEntry: true });
    assert.equal(r.context.exam, undefined);
    assert.equal(r.context.step, 'exam');
    assert.match(r.reply, /Which entrance exam/i);
  });

  test('WBJEE happy path with quota', async () => {
    const r = await runFlow(['6', '7000', '1', '1']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_WBJEE);
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'OPEN_AI');
  });

  test('JEE Main happy path gender + category expansion', async () => {
    const r = await runFlow(['7', '25000', '2', '5']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_JEE_MAIN);
    assert.ok(calls.at(-1).body.reservation_category_codes.length > 0);
    assert.ok(calls.at(-1).body.reservation_category_codes.some((x) => /OBC-NCL/.test(x)));
  });

  test('JEE Advanced happy path gender + category expansion', async () => {
    const r = await runFlow(['8', '7000', '1', '1']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_JEE_ADV);
    assert.deepEqual(calls.at(-1).body.reservation_category_codes, ['OPEN_AI']);
  });

  test('MHT CET happy path percentile flow', async () => {
    const r = await runFlow(['9', '94.5', '1', '1']);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.equal(calls.at(-1).exam, EXAM_MHT);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'SL');
    assert.ok(Number.isInteger(calls.at(-1).body.cutoff_from));
    assert.ok(Number.isInteger(calls.at(-1).body.cutoff_to));
  });

  test('AP EAMCET happy path with region and gender', async () => {
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    assert.equal(r.context.exam, EXAM_AP);
    r = await handleCollegePredictorMessage('5000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.context.step, 'gender');
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.gender, 'female');
    assert.equal(r.context.reservation_category_codes[0], 'OC GIRLS');
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.admission_category_name_enum, 'SVU');
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /AP EAMCET/);
    assert.match(r.reply, /GRIET/);
  });

  test('literal AU on region step predicts colleges', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('5000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.step, 'region');
    r = await handleCollegePredictorMessage('AU', r.context);
    assert.equal(r.context.admission_category_name_enum, 'AU');
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /Top Matches/);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'AU');
    assert.equal(/still in College Predictor/i.test(r.reply), false);
  });

  test('AU on results step re-predicts instead of sticky nav', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('5000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    r = await handleCollegePredictorMessage('SVU', r.context);
    assert.equal(r.context.step, 'results');
    assert.equal(r.context.admission_category_name_enum, 'SVU');
    const beforeCalls = calls.length;
    r = await handleCollegePredictorMessage('AU', r.context);
    assert.equal(r.context.admission_category_name_enum, 'AU');
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /Top Matches/);
    assert.equal(/still in College Predictor/i.test(r.reply), false);
    assert.ok(calls.length > beforeCalls);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'AU');
  });

  test('AGAIN clears prior region and result cache', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('5000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    r = await handleCollegePredictorMessage('AU', r.context);
    assert.equal(r.context.step, 'results');
    assert.ok(Array.isArray(r.context.resultCache));
    r = await handleCollegePredictorMessage('AGAIN', r.context);
    assert.equal(r.restart, true);
    assert.equal(r.context.step, 'exam');
    assert.equal(r.context.admission_category_name_enum, undefined);
    assert.equal(r.context.rank, undefined);
    assert.equal(r.context.resultCache, undefined);
  });

  test('AP OC Male blocks prediction without calling API', async () => {
    setCollegePredictorDeps({ getPredictedColleges: mockPredictorMustNotBeCalled() });
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.reply, AP_OC_MALE_BLOCKED_REPLY);
    assert.match(r.reply, /exact AP EAMCET reservation category/);
    assert.match(r.reply, /AGENT/);
    assert.match(r.reply, /MENU/);
    assert.equal(r.clearState, true);
    assert.equal(r.context.step, 'done');
    assert.equal(r.context.reservation_category_codes, undefined);
  });

  test('AP OC Female still predicts', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.reservation_category_codes[0], 'OC GIRLS');
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /Top Matches/);
    assert.match(r.reply, /Gender: Female/);
  });

  test('TS OC Male still predicts', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.context.reservation_category_codes[0], 'OC BOYS');
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /Top Matches/);
    assert.match(r.reply, /Gender: Male/);
  });

  test('AGAIN during rank step restarts at exam', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    assert.equal(r.context.step, 'category');
    r = await handleCollegePredictorMessage('again', r.context);
    assert.equal(r.context.step, 'exam');
    assert.equal(r.restart, true);
    assert.equal(r.reply, buildConversationalWelcome());
  });

  test('AGAIN during category step restarts at exam', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('again', r.context);
    assert.equal(r.context.step, 'exam');
    assert.equal(r.restart, true);
  });

  test('invalid rank keeps rank step', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('abc', r.context);
    assert.equal(r.context.step, 'rank');
    assert.match(r.reply, /rank as a number|valid.*rank|enter.*rank/i);
  });

  test('invalid category keeps category step', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('100', r.context);
    r = await handleCollegePredictorMessage('99', r.context);
    assert.equal(r.context.step, 'category');
    assert.match(r.reply, /couldn't identify|category|OC|BC/i);
  });

  test('invalid percentile keeps percentile step', async () => {
    let r = await handleCollegePredictorMessage('9', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('200', r.context);
    assert.equal(r.context.step, 'percentile');
    assert.match(r.reply, /1.?100|percentile/i);
  });

  test('invalid admission type keeps admission step (KCET)', async () => {
    let r = await handleCollegePredictorMessage('4', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('12000', r.context);
    r = await handleCollegePredictorMessage('9', r.context);
    assert.equal(r.context.step, 'admission_type');
    assert.match(r.reply, /admission type|General|HK/i);
  });

  test('invalid WBJEE quota-category combination bounces to category', async () => {
    let r = await handleCollegePredictorMessage('6', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('12000', r.context);
    r = await handleCollegePredictorMessage('5', r.context); // TUITION_FEE_WAIVER
    r = await handleCollegePredictorMessage('1', r.context); // all_india -> invalid
    assert.equal(r.context.step, 'category');
    assert.match(r.reply, /not available/i);
  });

  test('invalid region keeps region step (AP)', async () => {
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('100', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    r = await handleCollegePredictorMessage('9', r.context);
    assert.equal(r.context.step, 'region');
    assert.match(r.reply, /AU.*SVU|region/i);
  });

  test('predictor API failure preserves state for retry', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeFailPredictor(calls) });
    let r = await runFlow(['2', '15000', '4', '2']);
    assert.equal(r.context.step, 'predict');
    assert.match(r.reply, /could not fetch/i);

    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    r = await handleCollegePredictorMessage('retry', r.context);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /Top Matches/);
  });

  test('state cleanup after success', async () => {
    const lines = [];
    const orig = console.info;
    console.info = (_t, line) => lines.push(line);
    try {
      const r = await runFlow(['2', '15000', '1', '2']);
      assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
      assert.ok(lines.some((l) => l.includes('predictor_success')));
    } finally {
      console.info = orig;
    }
  });

  test('classifyIntent MENU during college_predictor', () => {
    const r = classifyIntent('menu', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('classifyIntent CANCEL during college_predictor', () => {
    const r = classifyIntent('cancel', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('classifyIntent AGENT during college_predictor', () => {
    const r = classifyIntent('agent', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'human_handoff');
  });

  test('classifyIntent digit 4 in college flow is continue not rank_predictor', () => {
    const r = classifyIntent('4', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'college_predictor_continue');
  });

  test('classifyIntent AGAIN starts college_predictor from main menu', () => {
    const r = classifyIntent('again', null, 'unknown');
    assert.equal(r.intent, 'college_predictor');
  });

  test('PROMPT_EXAM shows expanded exam list', () => {
    assert.match(buildConversationalWelcome(), /AP EAMCET/);
    assert.match(buildConversationalWelcome(), /TS EAMCET|JEE Main|KCET/);
  });

  test('conversational welcome on new entry', async () => {
    const r = await handleCollegePredictorMessage('I want to predict colleges', {}, { isNewEntry: true });
    assert.match(r.reply, /Sure!/);
    assert.match(r.reply, /Which entrance exam did you write/);
    assert.equal(r.context.step, 'exam');
    assert.equal(calls.length, 0);
  });

  test('natural language extracts exam and rank then asks category', async () => {
    let r = await handleCollegePredictorMessage('My TS EAMCET rank is 18453', {}, { isNewEntry: true });
    assert.equal(r.context.exam, EXAM_TS);
    assert.equal(r.context.rank, 18453);
    assert.equal(r.context.step, 'category');
    assert.match(r.reply, /category/i);
    assert.equal(calls.length, 0);
  });

  test('natural language full TS EAMCET sentence predicts', async () => {
    const r = await handleCollegePredictorMessage(
      'TS EAMCET rank 18453 BC-B male',
      {},
      { isNewEntry: true }
    );
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /TS EAMCET/);
    assert.match(r.reply, /18453/);
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'BCB BOYS');
  });

  test('natural language AP EAMCET extracts multiple slots', async () => {
    let r = await handleCollegePredictorMessage(
      'My AP EAMCET rank is 5432 BC-A Female',
      {},
      { isNewEntry: true }
    );
    assert.equal(r.context.exam, EXAM_AP);
    assert.equal(r.context.rank, 5432);
    assert.match(r.context.categoryLabel, /BC-A/);
    assert.equal(r.context.gender, 'female');
    assert.equal(r.context.step, 'region');
    assert.equal(calls.length, 0);
  });

  test('exam alias ts eamcet works', async () => {
    const r = await handleCollegePredictorMessage('ts eamcet', {}, { isNewEntry: true });
    assert.equal(r.context.exam, EXAM_TS);
    assert.equal(r.context.step, 'rank');
  });

  test('changing exam midway clears dependent slots', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('KCET', r.context);
    assert.equal(r.context.exam, EXAM_KCET);
    assert.equal(r.context.rank, undefined);
    assert.equal(r.context.step, 'rank');
  });

  test('natural language got rank in exam sentence', async () => {
    let r = await handleCollegePredictorMessage('I got 18453 in TS EAMCET.', {}, { isNewEntry: true });
    assert.equal(r.context.exam, EXAM_TS);
    assert.equal(r.context.rank, 18453);
    assert.equal(r.context.step, 'category');
  });

  test('natural language JEE Main AIR', async () => {
    let r = await handleCollegePredictorMessage('I wrote JEE Main AIR 24000.', {}, { isNewEntry: true });
    assert.equal(r.context.exam, EXAM_JEE_MAIN);
    assert.equal(r.context.rank, 24000);
    assert.equal(r.context.step, 'gender');
  });

  test('natural language MHT CET percentile', async () => {
    let r = await handleCollegePredictorMessage('I got 94.3 percentile in MHT CET.', {}, { isNewEntry: true });
    assert.equal(r.context.exam, EXAM_MHT);
    assert.equal(r.context.percentile, 94.3);
    assert.equal(r.context.step, 'admission_type');
  });

  test('empty prediction results message', async () => {
    setCollegePredictorDeps({
      getPredictedColleges: async () => ({ colleges: [], total_no_of_colleges: 0 }),
    });
    const r = await runFlow(['2', '15000', '4', '2']);
    assert.match(r.reply, /No colleges found/i);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
  });
});
