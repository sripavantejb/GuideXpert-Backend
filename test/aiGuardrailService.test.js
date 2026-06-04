'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  OPPORTUNITY_FALLBACK,
  UNKNOWN_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
  validateAiResponse,
} = require('../services/chatbot/aiGuardrailService');

describe('aiGuardrailService', () => {
  test('replaces guaranteed job claims with opportunity fallback', () => {
    const result = validateAiResponse({
      response: 'NIAT guarantees jobs.',
      knowledgeResults: [],
    });

    assert.equal(result.text, OPPORTUNITY_FALLBACK);
    assert.equal(result.modified, true);
    assert.equal(result.reason, 'guarantee_claim');
  });

  test('blocks unsupported numeric claims not present in retrieved knowledge', () => {
    const result = validateAiResponse({
      response: 'NIAT has 95% placements and 5000 companies.',
      knowledgeResults: [
        {
          question: 'What is NIAT?',
          answer: 'NIAT prepares students for industry-ready skills.',
        },
      ],
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result.modified, true);
    assert.equal(result.reason, 'unsupported_numeric_claim');
  });

  test('allows numeric claims when the exact values exist in retrieved knowledge', () => {
    const response = 'The program mentions 95% placements in the provided details.';
    const result = validateAiResponse({
      response,
      knowledgeResults: [
        {
          question: 'What placement details are available?',
          answer: 'The provided details mention 95% placements.',
        },
      ],
    });

    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('returns verified-information fallback for empty responses', () => {
    const result = validateAiResponse({ response: '   ', knowledgeResults: [] });

    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.modified, true);
    assert.equal(result.reason, 'empty_response');
  });
});
