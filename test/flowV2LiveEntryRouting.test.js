'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { matchesMainMenuTrigger } = require('../services/chatbot/intentTextUtils');
const { processCareerCounsellingFlowV2Turn } = require('../services/chatbot/guidedFlows/guidedFlowProcessors');

describe('Master Flow v2 live entry — retire legacy main-menu greeting', () => {
  test('hi / hello / start classify to career_counselling_flow_v2, not main_menu', () => {
    for (const t of ['hi', 'Hi', 'hello', 'hey', 'namaste', 'start']) {
      const result = classifyIntent(t, null, 'iit_counselling', t);
      assert.equal(
        result.intent,
        'career_counselling_flow_v2',
        `${t} must open Flow v2, got ${result.intent}`
      );
    }
  });

  test('explicit MENU / HELP still open the utility main_menu', () => {
    assert.equal(classifyIntent('menu', null, 'iit_counselling', 'menu').intent, 'main_menu');
    assert.equal(classifyIntent('help', null, 'iit_counselling', 'help').intent, 'main_menu');
    assert.equal(matchesMainMenuTrigger('hi'), false);
    assert.equal(matchesMainMenuTrigger('menu'), true);
  });

  test('college-uncertainty entry queries open Flow v2 instead of the frozen journey', () => {
    const result = classifyIntent(
      'I am confused which college to choose',
      null,
      'unknown',
      'I am confused which college to choose'
    );
    assert.equal(result.intent, 'career_counselling_flow_v2');
  });

  test('Flow v2 new-entry on hi starts Rithika Node E (not the IIT numbered menu)', async () => {
    const turn = await processCareerCounsellingFlowV2Turn({
      inboundText: 'hi',
      inbound: { _id: 'in1', messageType: 'text' },
      contextPatch: {},
      isNewEntry: true,
    });
    assert.equal(turn.nextState, 'career_counselling_flow_v2');
    const body = turn.interactive?.body || turn.replyText || '';
    assert.match(body, /Rithika/i);
    assert.doesNotMatch(body, /IIT & Engineering counselling journey/i);
    assert.doesNotMatch(body, /My Counselling Details/i);
  });
});
