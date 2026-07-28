'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');

const IIT_QUESTIONS = [
  'What is JoSAA?',
  'What is CSAB?',
  'Difference between IIT and NIT?',
  'Which IIT is best for CSE?',
  'What is branch sliding?',
  'What is freezing and floating?',
  'What are opening and closing ranks?',
  'How many rounds are there in JoSAA?',
  'What is home state quota?',
  'What is CRL rank?',
  'What is OBC-NCL rank?',
];

describe('IIT counselling expert intent routing — Master Flow v2 sole door', () => {
  let savedFlag;

  afterEach(() => {
    if (savedFlag === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = savedFlag;
    }
  });

  test('IIT counselling questions enter Flow v2 when flag is enabled', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    for (const message of IIT_QUESTIONS) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(result.intent, 'career_counselling_flow_v2', message);
    }
  });

  test('IIT counselling questions still enter Flow v2 when flag is disabled', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '0';

    const result = classifyIntent('What is JoSAA?', null, 'unknown', 'What is JoSAA?');
    assert.equal(result.intent, 'career_counselling_flow_v2');
  });

  test('active IIT session context still enters Flow v2', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    const botState = {
      state: 'idle',
      context: { iitCounsellingExpertActive: true },
    };

    for (const message of ['float', 'slide', 'how many rounds', 'What is float?']) {
      const result = classifyIntent(message, botState, 'unknown', message);
      assert.equal(result.intent, 'career_counselling_flow_v2', message);
    }
  });

  test('lead support queries enter Flow v2', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    const result = classifyIntent(
      'When is my session?',
      null,
      'iit_counselling',
      'When is my session?'
    );
    assert.equal(result.intent, 'career_counselling_flow_v2');
  });

  test('GuideXpert program questions enter Flow v2', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    const result = classifyIntent(
      'Do you provide IIT counselling support?',
      null,
      'unknown',
      'Do you provide IIT counselling support?'
    );
    assert.equal(result.intent, 'career_counselling_flow_v2');
  });
});
