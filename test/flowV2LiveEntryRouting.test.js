'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { matchesMainMenuTrigger } = require('../services/chatbot/intentTextUtils');
const { buildWelcomeMenuText } = require('../services/chatbot/welcomeMessageService');
const { processCareerCounsellingFlowV2Turn } = require('../services/chatbot/guidedFlows/guidedFlowProcessors');

describe('Master Flow v2 — sole live WhatsApp door', () => {
  const cases = [
    'hi',
    'hello',
    'start',
    'menu',
    'help',
    'I need career guidance',
    'which college should I choose',
    'Can I get CSE with rank 20000',
    'predict my rank',
    'what can you do',
    'what is GuideXpert',
    '1',
    'How is JoSAA counselling done',
  ];

  for (const t of cases) {
    test(`"${t}" classifies to career_counselling_flow_v2`, () => {
      const result = classifyIntent(t, null, 'iit_counselling', t);
      assert.equal(result.intent, 'career_counselling_flow_v2', `${t} → ${result.intent}`);
    });
  }

  test('explicit AGENT still handoffs', () => {
    assert.equal(classifyIntent('agent', null, 'unknown', 'agent').intent, 'human_handoff');
  });

  test('explicit STOP still opts out', () => {
    assert.equal(classifyIntent('stop', null, 'unknown', 'stop').intent, 'opt_out');
  });

  test('sticky Flow v2 continues', () => {
    const result = classifyIntent('ok', { state: 'career_counselling_flow_v2', context: {} }, 'unknown', 'ok');
    assert.equal(result.intent, 'career_counselling_flow_v2_continue');
  });

  test('legacy sticky predictor migrates into Flow v2', () => {
    const result = classifyIntent(
      'ok',
      { state: 'college_predictor', context: {} },
      'unknown',
      'ok'
    );
    assert.equal(result.intent, 'career_counselling_flow_v2');
    assert.equal(result.intentReason, 'migrate_legacy_guided_flow');
  });

  test('retired welcome text never includes the old IIT numbered menu', () => {
    const body = buildWelcomeMenuText({ productLine: 'iit_counselling', iit: { fullName: 'Kiran' } });
    assert.match(body, /Rithika/i);
    assert.doesNotMatch(body, /IIT & Engineering counselling journey/i);
    assert.doesNotMatch(body, /My Counselling Details/i);
    assert.equal(matchesMainMenuTrigger('hi'), false);
  });

  test('Flow v2 entry on hi starts Rithika Node E', async () => {
    const turn = await processCareerCounsellingFlowV2Turn({
      inboundText: 'hi',
      inbound: { _id: 'in1', messageType: 'text' },
      contextPatch: {},
      isNewEntry: true,
    });
    assert.equal(turn.nextState, 'career_counselling_flow_v2');
    const body = turn.interactive?.body || turn.replyText || '';
    assert.match(body, /Rithika/i);
    assert.doesNotMatch(body, /My Counselling Details/i);
  });
});
