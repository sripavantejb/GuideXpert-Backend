'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeContext } = require('../services/chatbot/botStateService');

describe('mergeContext', () => {
  test('replaces college atomically (no deep-merge pollution)', () => {
    const merged = mergeContext(
      { college: { exam: 'TS_EAMCET', rank: 15000, step: 'results', admission_category_name_enum: 'AU' } },
      { college: { flow: 'college_predictor', step: 'exam', conversational: true } }
    );
    assert.deepEqual(merged.college, {
      flow: 'college_predictor',
      step: 'exam',
      conversational: true,
    });
    assert.equal(merged.college.admission_category_name_enum, undefined);
    assert.equal(merged.college.rank, undefined);
  });

  test('empty college object resets slots', () => {
    const merged = mergeContext({ college: { exam: 'TS_EAMCET', rank: 1 } }, { college: {} });
    assert.deepEqual(merged.college, {});
  });

  test('deep merges rank slots without clobbering', () => {
    const merged = mergeContext({ rank: { step: 'score' } }, { rank: { score: 95 } });
    assert.deepEqual(merged.rank, { step: 'score', score: 95 });
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
