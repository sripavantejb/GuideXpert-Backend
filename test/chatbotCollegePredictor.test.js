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
  PROMPT_EXAM,
  AP_OC_MALE_BLOCKED_REPLY,
  mapExamChoice,
} = require('../constants/whatsappCollegePredictor');

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
    assert.equal(r.clearState, true);
    assert.match(r.reply, /TS EAMCET/);
    assert.match(r.reply, /Rank\/Percentile: 15000/);
    assert.match(r.reply, /BC-C/);
    assert.match(r.reply, /Gender: Female/);
    assert.match(r.reply, /VNR VJIET/);
    assert.equal(r.context.step, 'done');
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'DEFAULT');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'BCC GIRLS');
  });

  test('TNEA happy path', async () => {
    const r = await runFlow(['3', '12000', '2']);
    assert.equal(r.clearState, true);
    assert.equal(calls.at(-1).exam, EXAM_TNEA);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'DEFAULT');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'BC');
  });

  test('KCET happy path with admission type then category', async () => {
    const r = await runFlow(['4', '9500', '2', '3']);
    assert.equal(r.clearState, true);
    assert.equal(calls.at(-1).exam, EXAM_KCET);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'HK');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], '2BG');
  });

  test('KEAM happy path', async () => {
    const r = await runFlow(['5', '5000', '2']);
    assert.equal(r.clearState, true);
    assert.equal(calls.at(-1).exam, EXAM_KEAM);
    assert.equal(calls.at(-1).body.admission_category_name_enum, 'DEFAULT');
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'EW');
  });

  test('WBJEE happy path with quota', async () => {
    const r = await runFlow(['6', '7000', '1', '1']);
    assert.equal(r.clearState, true);
    assert.equal(calls.at(-1).exam, EXAM_WBJEE);
    assert.equal(calls.at(-1).body.reservation_category_codes[0], 'OPEN_AI');
  });

  test('JEE Main happy path gender + category expansion', async () => {
    const r = await runFlow(['7', '25000', '2', '5']);
    assert.equal(r.clearState, true);
    assert.equal(calls.at(-1).exam, EXAM_JEE_MAIN);
    assert.ok(calls.at(-1).body.reservation_category_codes.length > 0);
    assert.ok(calls.at(-1).body.reservation_category_codes.some((x) => /OBC-NCL/.test(x)));
  });

  test('JEE Advanced happy path gender + category expansion', async () => {
    const r = await runFlow(['8', '7000', '1', '1']);
    assert.equal(r.clearState, true);
    assert.equal(calls.at(-1).exam, EXAM_JEE_ADV);
    assert.deepEqual(calls.at(-1).body.reservation_category_codes, ['OPEN_AI']);
  });

  test('MHT CET happy path percentile flow', async () => {
    const r = await runFlow(['9', '94.5', '1', '1']);
    assert.equal(r.clearState, true);
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
    assert.equal(r.clearState, true);
    assert.match(r.reply, /AP EAMCET/);
    assert.match(r.reply, /GRIET/);
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
    assert.equal(r.clearState, true);
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
    assert.equal(r.clearState, true);
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
    assert.equal(r.reply, PROMPT_EXAM);
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
    assert.match(r.reply, /valid positive number/);
  });

  test('invalid category keeps category step', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('100', r.context);
    r = await handleCollegePredictorMessage('99', r.context);
    assert.equal(r.context.step, 'category');
    assert.match(r.reply, /valid option number/i);
  });

  test('invalid percentile keeps percentile step', async () => {
    let r = await handleCollegePredictorMessage('9', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('200', r.context);
    assert.equal(r.context.step, 'percentile');
    assert.match(r.reply, /1 to 100/);
  });

  test('invalid admission type keeps admission step (KCET)', async () => {
    let r = await handleCollegePredictorMessage('4', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('12000', r.context);
    r = await handleCollegePredictorMessage('9', r.context);
    assert.equal(r.context.step, 'admission_type');
    assert.match(r.reply, /valid option number/i);
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
    assert.match(r.reply, /1 or 2/);
  });

  test('predictor API failure preserves state for retry', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeFailPredictor(calls) });
    let r = await runFlow(['2', '15000', '4', '2']);
    assert.equal(r.context.step, 'predict');
    assert.match(r.reply, /could not fetch/i);

    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    r = await handleCollegePredictorMessage('retry', r.context);
    assert.equal(r.clearState, true);
    assert.match(r.reply, /Top Matches/);
  });

  test('state cleanup after success', async () => {
    const r = await runFlow(['2', '15000', '1', '2']);
    assert.equal(r.clearState, true);
    assert.equal(r.context.step, 'done');
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
    assert.match(PROMPT_EXAM, /AP EAMCET/);
    assert.match(PROMPT_EXAM, /MHT CET/);
  });
});
