'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeContext } = require('../services/chatbot/botStateService');

describe('mergeContext', () => {
  test('deep merges college slots without clobbering', () => {
    const merged = mergeContext({ college: { exam: 'TS_EAMCET' } }, { college: { rank: 15000 } });
    assert.deepEqual(merged.college, { exam: 'TS_EAMCET', rank: 15000 });
  });

  test('empty college object resets slots', () => {
    const merged = mergeContext({ college: { exam: 'TS_EAMCET', rank: 1 } }, { college: {} });
    assert.deepEqual(merged.college, {});
  });

  test('shallow merge for other keys', () => {
    const merged = mergeContext({ knowledgeAssistantActive: true }, { optedOut: true });
    assert.equal(merged.knowledgeAssistantActive, true);
    assert.equal(merged.optedOut, true);
  });

  test('predictionIdempotency replaces atomically', () => {
    const record = { lastPredictionInboundId: 'abc', predictionCompleted: true };
    const merged = mergeContext({ predictionIdempotency: record }, { predictionIdempotency: null });
    assert.equal(merged.predictionIdempotency, null);
  });
});
