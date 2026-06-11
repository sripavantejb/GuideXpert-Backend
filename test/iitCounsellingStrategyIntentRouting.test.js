'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');

const STRATEGY_QUESTIONS = [
  'CSE vs ECE?',
  'Which is better, IIT or NIT?',
  'Should I choose branch or college?',
  'When should I use float?',
  'When should I freeze?',
  'Which JoSAA option is safer?',
  'Should I prefer circuit branches?',
  'Is branch sliding useful?',
];

describe('IIT counselling strategy intent routing', () => {
  let savedIceFlag;
  let savedStrategyFlag;

  afterEach(() => {
    if (savedIceFlag === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = savedIceFlag;
    }
    if (savedStrategyFlag === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = savedStrategyFlag;
    }
  });

  test('routes strategy questions when ICE and strategy flags are enabled', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    for (const message of STRATEGY_QUESTIONS) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(result.intent, 'iit_counselling_strategy', message);
      assert.equal(result.intentReason, 'iit_counselling_strategy_question', message);
    }
  });

  test('does not route strategy when strategy flag is disabled', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '0';

    const result = classifyIntent('CSE vs ECE?', null, 'unknown', 'CSE vs ECE?');
    assert.notEqual(result.intent, 'iit_counselling_strategy');
  });

  test('does not route strategy when ICE flag is disabled', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '0';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const result = classifyIntent('CSE vs ECE?', null, 'unknown', 'CSE vs ECE?');
    assert.notEqual(result.intent, 'iit_counselling_strategy');
  });

  test('factual ICE questions still route to ICE when strategy is enabled', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    for (const message of ['What is float?', 'What is OBC-NCL rank?', 'What is home state quota?']) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(result.intent, 'iit_counselling_expert', message);
    }
  });

  test('active strategy session keeps follow-ups on iit_counselling_strategy', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const botState = {
      state: 'idle',
      context: { iitCounsellingStrategyActive: true },
    };

    for (const message of ['Which has better placements?', 'What if I like coding?']) {
      const result = classifyIntent(message, botState, 'unknown', message);
      assert.equal(result.intent, 'iit_counselling_strategy', message);
      assert.equal(result.intentReason, 'iit_counselling_strategy_session_active', message);
    }
  });

  test('strategy question beats active CPA session', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const botState = {
      state: 'idle',
      context: { counsellorProgramAssistantActive: true },
    };
    const result = classifyIntent('CSE vs ECE?', botState, 'unknown', 'CSE vs ECE?');
    assert.equal(result.intent, 'iit_counselling_strategy');
    assert.equal(result.intentReason, 'iit_counselling_strategy_question');
  });

  test('strategy question beats active ICE session for float timing', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const botState = {
      state: 'idle',
      context: { iitCounsellingExpertActive: true },
    };
    const result = classifyIntent(
      'When should I use float?',
      botState,
      'unknown',
      'When should I use float?'
    );
    assert.equal(result.intent, 'iit_counselling_strategy');
  });

  test('Hindi coding preference follow-up routes to strategy', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const botState = {
      state: 'idle',
      context: { iitCounsellingStrategyActive: true },
    };
    const result = classifyIntent('Coding pasand ho to?', botState, 'unknown', 'Coding pasand ho to?');
    assert.equal(result.intent, 'iit_counselling_strategy');
  });

  test('Telugu strategy opener routes to strategy', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const result = classifyIntent('CSE leda ECE?', null, 'unknown', 'CSE leda ECE?');
    assert.equal(result.intent, 'iit_counselling_strategy');
  });

  test('strategy routes before ICE for comparative IIT vs NIT question', () => {
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    const result = classifyIntent('IIT or NIT?', null, 'unknown', 'IIT or NIT?');
    assert.equal(result.intent, 'iit_counselling_strategy');
  });
});
