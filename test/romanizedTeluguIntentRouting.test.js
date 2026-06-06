'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');

const PRODUCT_LINE = 'iit_counselling';

function assertIntent(original, expectedIntent, englishMessage = null) {
  const r = classifyIntent(
    englishMessage || original,
    null,
    PRODUCT_LINE,
    original
  );
  assert.equal(
    r.intent,
    expectedIntent,
    `${original} (en=${englishMessage || original}) expected ${expectedIntent}, got ${r.intent}`
  );
}

describe('romanized Telugu greeting routing', () => {
  test('ela unnaru routes to greeting on original text', () => {
    assertIntent('ela unnaru', 'greeting', 'How are you doing?');
  });

  test('ela vunnaru routes to greeting', () => {
    assertIntent('ela vunnaru', 'greeting');
  });

  test('bagunnara routes to greeting', () => {
    assertIntent('bagunnara', 'greeting', 'How are you?');
  });
});

describe('romanized Telugu branch guidance routing', () => {
  test('naaku cse kavali routes to knowledge_assistant not college_predictor', () => {
    const r = classifyIntent('I want CSE', null, PRODUCT_LINE, 'naaku cse kavali');
    assert.equal(r.intent, 'knowledge_assistant');
    assert.equal(r.intentReason, 'romanized_telugu_branch_guidance');
  });

  test('naaku e branch manchidi routes to knowledge_assistant', () => {
    assertIntent('naaku e branch manchidi', 'knowledge_assistant', 'Which branch is good?');
  });

  test('software jobs kosam branch enti routes to knowledge_assistant', () => {
    assertIntent(
      'software jobs kosam branch enti',
      'knowledge_assistant',
      'Which branch for software jobs?'
    );
  });

  test('nenu software engineer avvali routes to knowledge_assistant', () => {
    assertIntent(
      'nenu software engineer avvali',
      'knowledge_assistant',
      'I want to become a software engineer'
    );
  });
});

describe('romanized Telugu college predictor routing', () => {
  test('15000 rank ki cse vastunda routes to college_predictor', () => {
    assertIntent(
      '15000 rank ki cse vastunda',
      'college_predictor',
      'Can I get CSE with rank 15000?'
    );
  });

  test('15000 rank tho cse vastunda routes to college_predictor', () => {
    assertIntent(
      '15000 rank tho cse vastunda',
      'college_predictor',
      'Can I get CSE with rank 15000?'
    );
  });
});

describe('romanized Telugu rank predictor routing', () => {
  test('ts eamcet 85 marks routes to rank_predictor', () => {
    assertIntent('ts eamcet 85 marks', 'rank_predictor');
  });

  test('ap eamcet 90 marks routes to rank_predictor', () => {
    assertIntent('ap eamcet 90 marks', 'rank_predictor');
  });

  test('jee mains 120 score routes to rank_predictor', () => {
    assertIntent('jee mains 120 score', 'rank_predictor');
  });

  test('branch-only romanized text does not route to rank_predictor', () => {
    const cases = [
      'naaku cse kavali',
      'naaku e branch manchidi',
      'software jobs kosam branch enti',
      'ela unnaru',
    ];
    for (const text of cases) {
      const r = classifyIntent(text, null, PRODUCT_LINE, text);
      assert.notEqual(r.intent, 'rank_predictor', text);
    }
  });

  test('active rank predictor session continues without marks in message', () => {
    const r = classifyIntent(
      'naaku cse kavali',
      { state: 'rank_predictor', context: {} },
      PRODUCT_LINE,
      'naaku cse kavali'
    );
    assert.equal(r.intent, 'rank_predictor_continue');
  });
});
