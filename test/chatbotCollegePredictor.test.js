'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const {
  buildPredictorRequestBody,
  resolveReservationCode,
  isApOcMaleBlocked,
  EXAM_AP,
  EXAM_TS,
  PROMPT_EXAM,
  AP_OC_MALE_BLOCKED_REPLY,
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

function mockPredictorSuccess() {
  return async (exam, offset, limit, body) => {
    return { ...MOCK_COLLEGES, _body: body, _exam: exam, _offset: offset, _limit: limit };
  };
}

function mockPredictorFail() {
  return async () => {
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

async function runTsToPredict(ctx, { category = '4', gender = '2' } = {}) {
  let r = await handleCollegePredictorMessage('2', ctx);
  r = await handleCollegePredictorMessage('15000', r.context);
  r = await handleCollegePredictorMessage(category, r.context);
  r = await handleCollegePredictorMessage(gender, r.context);
  return r;
}

describe('chatbotCollegePredictor', () => {
  beforeEach(() => {
    setCollegePredictorDeps({ getPredictedColleges: mockPredictorSuccess() });
  });

  afterEach(() => {
    setCollegePredictorDeps({});
  });

  test('TS EAMCET happy path with gender', async () => {
    let r = await handleCollegePredictorMessage('ignored', {}, { isNewEntry: true });
    assert.match(r.reply, /AP EAMCET/);
    assert.equal(r.context.step, 'exam');

    r = await runTsToPredict(r.context, { category: '4', gender: '2' });
    assert.equal(r.clearState, true);
    assert.match(r.reply, /TS EAMCET/);
    assert.match(r.reply, /Rank: 15000/);
    assert.match(r.reply, /BC-C/);
    assert.match(r.reply, /Gender: Female/);
    assert.match(r.reply, /VNR VJIET/);
    assert.equal(r.context.step, 'done');
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
    assert.match(r.reply, /AGENT → Talk to Expert/);
    assert.match(r.reply, /MENU → Main Menu/);
    assert.equal(r.clearState, true);
    assert.equal(r.context.step, 'done');
    assert.equal(r.context.reservation_category_codes, undefined);
  });

  test('AP OC Female still predicts', async () => {
    setCollegePredictorDeps({ getPredictedColleges: mockPredictorSuccess() });
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
    setCollegePredictorDeps({ getPredictedColleges: mockPredictorSuccess() });
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.context.reservation_category_codes[0], 'OC BOYS');
    assert.equal(r.clearState, true);
    assert.match(r.reply, /Top Matches/);
    assert.match(r.reply, /Gender: Male/);
  });

  test('male flow TS OC maps to OC BOYS', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.context.gender, 'male');
    assert.equal(r.context.reservation_category_codes[0], 'OC BOYS');
    assert.equal(r.clearState, true);
    assert.match(r.reply, /Gender: Male/);
  });

  test('female flow AP BC-C maps to BCC GIRLS', async () => {
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('8000', r.context);
    r = await handleCollegePredictorMessage('4', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.reservation_category_codes[0], 'BCC GIRLS');
    r = await handleCollegePredictorMessage('1', r.context);
    assert.equal(r.clearState, true);
    assert.match(r.reply, /Gender: Female/);
    assert.match(r.reply, /BC-C/);
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

  test('createHandoff clears college context on transitionState', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/chatbot/handoffService.js'),
      'utf8'
    );
    assert.match(src, /human_handoff',\s*\{\s*college:\s*\{\}\s*\}/);
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
    assert.match(r.reply, /1 to 9/);
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
    setCollegePredictorDeps({ getPredictedColleges: mockPredictorFail() });
    let r = await runTsToPredict({}, { category: '4', gender: '2' });
    assert.equal(r.context.step, 'predict');
    assert.match(r.reply, /could not fetch/i);

    setCollegePredictorDeps({ getPredictedColleges: mockPredictorSuccess() });
    r = await handleCollegePredictorMessage('retry', r.context);
    assert.equal(r.clearState, true);
    assert.match(r.reply, /Top Matches/);
  });

  test('state cleanup after success', async () => {
    const r = await runTsToPredict({}, { category: '1', gender: '2' });
    assert.equal(r.clearState, true);
    assert.equal(r.context.step, 'done');
  });

  test('resolveReservationCode gender-aware mappings', () => {
    assert.equal(resolveReservationCode(EXAM_TS, 1, 'male'), 'OC BOYS');
    assert.equal(resolveReservationCode(EXAM_TS, 1, 'female'), 'OC GIRLS');
    assert.equal(resolveReservationCode(EXAM_AP, 1, 'female'), 'OC GIRLS');
    assert.equal(resolveReservationCode(EXAM_AP, 1, 'male'), null);
    assert.equal(isApOcMaleBlocked(EXAM_AP, 1, 'male'), true);
    assert.equal(isApOcMaleBlocked(EXAM_AP, 1, 'female'), false);
    assert.equal(isApOcMaleBlocked(EXAM_TS, 1, 'male'), false);
    assert.equal(resolveReservationCode(EXAM_TS, 9, 'female'), 'EWS GEN OU');
    assert.equal(resolveReservationCode(EXAM_TS, 9, 'male'), 'OC EWS BOYS');
    assert.equal(resolveReservationCode(EXAM_AP, 3, 'male'), 'BCB BOYS');
  });

  test('buildPredictorRequestBody uses resolved reservation', () => {
    const body = buildPredictorRequestBody({
      exam: EXAM_TS,
      rank: 15000,
      reservation_category_codes: ['OC BOYS'],
    });
    assert.equal(body.reservation_category_codes[0], 'OC BOYS');
    assert.equal(body.admission_category_name_enum, 'DEFAULT');
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
});
