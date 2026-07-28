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
  test('ela unnaru routes to Flow v2 on original text', () => {
    const r = classifyIntent('How are you doing?', null, PRODUCT_LINE, 'ela unnaru');
    assert.equal(r.intent, 'career_counselling_flow_v2');
    assert.equal(r.intentReason, 'romanized_telugu_greeting_flow_v2');
  });

  test('ela vunnaru routes to Flow v2', () => {
    assertIntent('ela vunnaru', 'career_counselling_flow_v2');
  });

  test('bagunnara routes to Flow v2', () => {
    assertIntent('bagunnara', 'career_counselling_flow_v2', 'How are you?');
  });
});

describe('romanized Telugu student talk routes to Master Flow v2', () => {
  test('naaku cse kavali routes to Flow v2', () => {
    assertIntent('naaku cse kavali', 'career_counselling_flow_v2', 'I want CSE');
  });

  test('naaku e branch manchidi routes to Flow v2', () => {
    assertIntent('naaku e branch manchidi', 'career_counselling_flow_v2', 'Which branch is good?');
  });

  test('software jobs kosam branch enti routes to Flow v2', () => {
    assertIntent(
      'software jobs kosam branch enti',
      'career_counselling_flow_v2',
      'Which branch for software jobs?'
    );
  });

  test('nenu software engineer avvali routes to Flow v2', () => {
    assertIntent(
      'nenu software engineer avvali',
      'career_counselling_flow_v2',
      'I want to become a software engineer'
    );
  });

  test('15000 rank ki cse vastunda routes to Flow v2', () => {
    assertIntent(
      '15000 rank ki cse vastunda',
      'career_counselling_flow_v2',
      'Can I get CSE with rank 15000?'
    );
  });

  test('ts eamcet 85 marks routes to Flow v2', () => {
    assertIntent('ts eamcet 85 marks', 'career_counselling_flow_v2');
  });

  test('legacy rank_predictor sticky migrates into Flow v2', () => {
    const r = classifyIntent(
      'naaku cse kavali',
      { state: 'rank_predictor', context: {} },
      PRODUCT_LINE,
      'naaku cse kavali'
    );
    assert.equal(r.intent, 'career_counselling_flow_v2');
    assert.equal(r.intentReason, 'migrate_legacy_guided_flow');
  });
});
