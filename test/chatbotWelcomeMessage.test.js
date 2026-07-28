'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractFirstName,
  formatWelcomeSalutation,
  buildWelcomeMenuText,
} = require('../services/chatbot/welcomeMessageService');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { mapMenuIdToIntent } = require('../services/chatbot/chatbotOrchestratorService');

describe('welcomeMessageService — legacy menus retired', () => {
  test('extractFirstName returns first token', () => {
    assert.equal(extractFirstName('Ravi Kumar'), 'Ravi');
    assert.equal(extractFirstName('  Priya  '), 'Priya');
    assert.equal(extractFirstName(''), null);
    assert.equal(extractFirstName(null), null);
  });

  test('welcome text is Rithika bridge for every product line', () => {
    for (const line of ['iit_counselling', 'guidexpert', 'unknown']) {
      const text = buildWelcomeMenuText({
        productLine: line,
        iit: { fullName: 'Priya Sharma' },
        gx: { fullName: 'Amit Verma' },
      });
      assert.match(text, /Rithika/i);
      assert.doesNotMatch(text, /My Counselling Details/);
      assert.doesNotMatch(text, /Certified Career Counsellor/);
      assert.doesNotMatch(text, /IIT \/ College Counselling/);
    }
  });

  test('GX salutation helper still works for non-menu uses', () => {
    assert.match(
      formatWelcomeSalutation({ productLine: 'guidexpert', gx: {} }),
      /Hi there!/
    );
  });
});

describe('digit / menu routing — Master Flow v2 sole door', () => {
  test('legacy digit taps classify to Flow v2', () => {
    assert.equal(classifyIntent('3', null, 'iit_counselling').intent, 'career_counselling_flow_v2');
    assert.equal(classifyIntent('2', null, 'guidexpert').intent, 'career_counselling_flow_v2');
    assert.equal(classifyIntent('1', null, 'unknown').intent, 'career_counselling_flow_v2');
  });

  test('interactive agent row still handoffs', () => {
    assert.equal(mapMenuIdToIntent('menu_6', 'iit_counselling'), 'human_handoff');
    assert.equal(mapMenuIdToIntent('menu_agent', 'unknown'), 'human_handoff');
  });

  test('interactive counselling rows enter Flow v2', () => {
    assert.equal(mapMenuIdToIntent('menu_1', 'iit_counselling'), 'career_counselling_flow_v2');
    assert.equal(mapMenuIdToIntent('menu_5', 'iit_counselling'), 'career_counselling_flow_v2');
  });
});
