'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { searchStaticFaq } = require('../services/chatbot/faqService');
const {
  buildMainMenuText,
  buildMainMenuListSections,
  mapMenuIdToIntent,
} = require('../services/chatbot/chatbotOrchestratorService');

describe('chatbotOrchestrator rules', () => {
  test('classifyIntent detects agent keyword', () => {
    const r = classifyIntent('I need to talk to an agent', null, 'unknown');
    assert.equal(r.intent, 'human_handoff');
  });

  test('classifyIntent detects menu', () => {
    const r = classifyIntent('menu', null, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('classifyIntent digit 4 in college_predictor state is continue', () => {
    const r = classifyIntent('4', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'college_predictor_continue');
  });

  test('classifyIntent rank predictor via natural language on guidexpert', () => {
    const r = classifyIntent('rank predictor', null, 'guidexpert');
    assert.equal(r.intent, 'rank_predictor');
  });

  test('static FAQ search finds meeting link', () => {
    const hits = searchStaticFaq('what is the meeting link');
    assert.ok(hits.length > 0);
  });

  test('buildMainMenuText organic welcome options', () => {
    const text = buildMainMenuText({ productLine: 'unknown', iit: null, gx: null });
    assert.match(text, /IIT \/ College Counselling/);
    assert.match(text, /Talk to an Expert/);
  });

  test('buildMainMenuText IIT welcome options', () => {
    const text = buildMainMenuText({
      productLine: 'iit_counselling',
      iit: { fullName: 'Test User' },
    });
    assert.match(text, /My Counselling Details/);
    assert.match(text, /My Assigned Expert/);
    assert.match(text, /College Predictor/);
    assert.match(text, /Talk to My Counsellor/);
  });

  test('IIT list menu exposes college predictor', () => {
    const rows = buildMainMenuListSections()[0].rows.map((r) => r.id);
    assert.ok(rows.includes('menu_5'));
    assert.equal(mapMenuIdToIntent('menu_5', 'iit_counselling'), 'college_predictor');
  });
});
