'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { handleRankPredictorMessage } = require('../services/chatbot/rankPredictorChatService');
const { emptySubflows } = require('../services/chatbot/botSubflowContext');

describe('rankPredictorChatService', () => {
  test('happy path returns prediction for exam and score', () => {
    const r = handleRankPredictorMessage('JEE Main 85', {});
    assert.match(r.reply, /Prediction for/i);
    assert.match(r.reply, /85|Rank|Percentile/i);
    assert.equal(r.context.step, 'done');
  });

  test('invalid score returns validation message', () => {
    const r = handleRankPredictorMessage('999999', {
      step: 'awaiting_score',
      examId: 'jeemainmarks',
    });
    assert.match(r.reply, /between|Could not predict|score range/i);
    assert.equal(r.context.step, 'awaiting_exam_score');
  });

  test('classifyIntent MENU during rank_predictor returns main_menu', () => {
    const r = classifyIntent('menu', { state: 'rank_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('classifyIntent CANCEL during rank_predictor returns main_menu', () => {
    const r = classifyIntent('cancel', { state: 'rank_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('AGAIN during rank flow continues rank predictor not college restart', () => {
    const r = classifyIntent('again', { state: 'rank_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'rank_predictor_continue');
  });

  test('AGAIN outside rank flow starts college predictor', () => {
    const r = classifyIntent('again', { state: 'main_menu' }, 'iit_counselling');
    assert.equal(r.intent, 'college_predictor');
  });

  test('AGAIN text in rank handler is not parsed as numeric score', () => {
    const r = handleRankPredictorMessage('again', {
      step: 'awaiting_score',
      examId: 'kcet',
    });
    assert.match(r.reply, /Which exam|Send your kcet score/i);
    assert.notEqual(r.context.step, 'done');
  });

  test('emptySubflows clears rank and college while preserving other context', () => {
    const existing = {
      optedOut: false,
      college: { exam: 'AP', step: 'category', rank: 5000 },
      rank: { step: 'awaiting_score', examId: 'kcet' },
    };
    const merged = { ...existing, ...emptySubflows() };
    assert.deepEqual(merged.college, {});
    assert.deepEqual(merged.rank, {});
    assert.equal(merged.optedOut, false);
  });
});
