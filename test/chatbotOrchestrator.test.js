'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { searchStaticFaq } = require('../services/chatbot/faqService');
const { buildMainMenuText } = require('../services/chatbot/chatbotOrchestratorService');

describe('chatbotOrchestrator rules', () => {
  test('classifyIntent detects agent keyword', () => {
    const r = classifyIntent('I need to talk to an agent', null, 'unknown');
    assert.equal(r.intent, 'human_handoff');
  });

  test('classifyIntent detects menu', () => {
    const r = classifyIntent('menu', null, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('classifyIntent rank predictor shortcut', () => {
    const r = classifyIntent('3', null, 'guidexpert');
    assert.equal(r.intent, 'rank_predictor');
  });

  test('static FAQ search finds meeting link', () => {
    const hits = searchStaticFaq('what is the meeting link');
    assert.ok(hits.length > 0);
  });

  test('buildMainMenuText includes options', () => {
    const text = buildMainMenuText({ productLine: 'unknown', iit: null, gx: null }, {
      mainMenuGreeting: () => 'Hello',
    });
    assert.match(text, /My details/);
    assert.match(text, /Talk to an agent/);
  });
});
