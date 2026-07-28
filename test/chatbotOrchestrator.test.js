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

  test('classifyIntent detects menu as Flow v2', () => {
    const r = classifyIntent('menu', null, 'iit_counselling');
    assert.equal(r.intent, 'career_counselling_flow_v2');
  });

  test('classifyIntent digit 4 in college_predictor state migrates to Flow v2', () => {
    const r = classifyIntent('4', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'career_counselling_flow_v2');
  });

  test('classifyIntent rank predictor via natural language on guidexpert', () => {
    const r = classifyIntent('rank predictor', null, 'guidexpert');
    assert.equal(r.intent, 'career_counselling_flow_v2');
  });

  test('static FAQ search finds meeting link', () => {
    const hits = searchStaticFaq('what is the meeting link');
    assert.ok(hits.length > 0);
  });

  test('buildMainMenuText organic is Rithika bridge', () => {
    const text = buildMainMenuText({ productLine: 'unknown' });
    assert.match(text, /Rithika/i);
    assert.doesNotMatch(text, /IIT \/ College Counselling/);
  });

  test('buildMainMenuText IIT is Rithika bridge', () => {
    const text = buildMainMenuText({ productLine: 'iit_counselling', iit: { fullName: 'A' } });
    assert.match(text, /Rithika/i);
    assert.doesNotMatch(text, /My Counselling Details/);
  });

  test('IIT list menu row ids still exist but map into Flow v2', () => {
    const rows = buildMainMenuListSections()[0].rows.map((r) => r.id);
    assert.ok(rows.includes('menu_5'));
    assert.equal(mapMenuIdToIntent('menu_5', 'iit_counselling'), 'career_counselling_flow_v2');
  });
});
