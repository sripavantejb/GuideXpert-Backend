'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyIntent,
  isCounsellorProgramQuestion,
  isIitLeadSupportQuery,
} = require('../services/chatbot/intentClassifierService');

const PROGRAM_QUESTIONS = [
  'What counselling services do you provide?',
  'Which program is suitable for me?',
  'What are the benefits of your counselling?',
  'How does the counselling process work?',
  'Do you provide IIT counselling?',
  'Do you provide college prediction support?',
  'Do you provide mentorship?',
  'What is included in your program?',
  'What are the fees?',
  'How long does the program last?',
  'How can I join?',
];

describe('counsellor program intent routing', () => {
  test('routes supported program-discovery questions to counsellor_program_assistant', () => {
    for (const message of PROGRAM_QUESTIONS) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(
        result.intent,
        'counsellor_program_assistant',
        `expected CPA for: ${message}`
      );
      assert.equal(result.intentReason, 'counsellor_program_question');
    }
  });

  test('isCounsellorProgramQuestion matches program keywords from spec', () => {
    const samples = [
      'Tell me about your counselling program package',
      'What career guidance do you offer?',
      'Do you have admission guidance?',
      'I need college counselling support',
    ];
    for (const message of samples) {
      assert.equal(
        isCounsellorProgramQuestion(message),
        true,
        `expected program match: ${message}`
      );
    }
  });

  test('active counsellor program session keeps follow-ups on counsellor_program_assistant', () => {
    const botState = {
      state: 'idle',
      context: { counsellorProgramAssistantActive: true },
    };
    const result = classifyIntent('tell me more about fees', botState, 'unknown', 'tell me more about fees');
    assert.equal(result.intent, 'counsellor_program_assistant');
    assert.equal(result.intentReason, 'counsellor_program_session_active');
  });

  test('IIT lead support queries are excluded from counsellor program assistant', () => {
    const leadQueries = [
      'When is my session?',
      'Send my meeting link',
      'Who is my assigned expert?',
      'My counsellor has not called yet',
    ];
    for (const message of leadQueries) {
      assert.equal(isIitLeadSupportQuery(message), true, message);
      assert.equal(isCounsellorProgramQuestion(message), false, message);
    }
  });

  test('human handoff still wins for explicit agent requests', () => {
    const result = classifyIntent('talk to counsellor please', null, 'unknown', 'talk to counsellor please');
    assert.equal(result.intent, 'human_handoff');
  });

  test('program questions route to CPA even when KA session is active', () => {
    const botState = {
      state: 'idle',
      context: { knowledgeAssistantActive: true },
    };
    for (const message of ['What are the fees?', 'fees']) {
      const result = classifyIntent(message, botState, 'unknown', message);
      assert.equal(result.intent, 'counsellor_program_assistant', `expected CPA for: ${message}`);
    }
  });

  test('GuideXpert identity routes to CPA even when KA session is active', () => {
    const botState = {
      state: 'idle',
      context: { knowledgeAssistantActive: true },
    };
    const result = classifyIntent('What is GuideXpert?', botState, 'unknown', 'What is GuideXpert?');
    assert.equal(result.intent, 'counsellor_program_assistant');
    assert.equal(result.intentReason, 'guidexpert_identity_question');
  });

  test('GuideXpert identity questions route to counsellor_program_assistant', () => {
    const messages = [
      'What is GuideXpert?',
      'Tell me about GuideXpert.',
      'I want to know about GuideXpert.',
    ];
    for (const message of messages) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(result.intent, 'counsellor_program_assistant', message);
      assert.equal(result.intentReason, 'guidexpert_identity_question', message);
    }
  });

  test('guidexpert discovery phrases are not classified as unknown', () => {
    const messages = [
      'what is guidexpert',
      'i want to know about guidexpert',
      'tell me about guidexpert',
      'tell me about niat',
      'know about guidexpert',
    ];
    for (const message of messages) {
      const result = classifyIntent(message, null, 'iit_counselling', message);
      assert.notEqual(result.intent, 'unknown', `expected routed intent for: ${message}`);
    }
  });

  test('what counselling programs do you provide routes to counsellor_program_assistant', () => {
    const result = classifyIntent(
      'what counselling programs do you provide',
      null,
      'iit_counselling',
      'what counselling programs do you provide'
    );
    assert.equal(result.intent, 'counsellor_program_assistant');
  });

  test('fees follow-up continues counsellor program session', () => {
    const botState = {
      state: 'idle',
      context: { counsellorProgramAssistantActive: true },
    };
    const result = classifyIntent('fees', botState, 'iit_counselling', 'fees');
    assert.equal(result.intent, 'counsellor_program_assistant');
    assert.equal(result.intentReason, 'counsellor_program_session_active');
  });

  test('program questions with support keyword still route to CPA not handoff', () => {
    const result = classifyIntent(
      'Do you provide college prediction support?',
      null,
      'unknown',
      'Do you provide college prediction support?'
    );
    assert.equal(result.intent, 'counsellor_program_assistant');
    assert.equal(result.intentReason, 'counsellor_program_question');
  });

  test('standalone program keywords route to counsellor_program_assistant without session', () => {
    const messages = [
      'fees',
      'fee',
      'price',
      'pricing',
      'cost',
      'benefits',
      'duration',
      'mentorship',
      'sessions',
      'fees kya hai',
      'price kya hai',
      'benefits kya hai',
      'fees enti',
      'benefits enti',
    ];
    for (const message of messages) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(
        result.intent,
        'counsellor_program_assistant',
        `expected CPA for: ${message}`
      );
    }
  });

  test('multilingual program discovery routes to counsellor_program_assistant', () => {
    const messages = [
      'aap kaunse counselling programs provide karte ho',
      'mee counselling programs enti',
    ];
    for (const message of messages) {
      const result = classifyIntent(message, null, 'unknown', message);
      assert.equal(result.intent, 'counsellor_program_assistant');
    }
  });

  test('follow-up conversation stays in counsellor_program_assistant session', () => {
    const botState = {
      state: 'idle',
      context: { counsellorProgramAssistantActive: true },
    };
    const followUps = [
      'fees',
      'benefits',
      'mentorship',
      'duration',
      'fees kya hai',
      'benefits enti',
    ];
    for (const message of followUps) {
      const result = classifyIntent(message, botState, 'unknown', message);
      assert.equal(result.intent, 'counsellor_program_assistant', message);
      assert.equal(result.intentReason, 'counsellor_program_session_active', message);
    }
  });
});
