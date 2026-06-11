'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateIitCounsellingResponse,
  ICE_EMPTY_FALLBACK,
  UNKNOWN_FALLBACK,
} = require('../services/chatbot/iitCounsellingExpert/iitCounsellingGuardrailService');

describe('iitCounsellingGuardrailService', () => {
  test('returns empty fallback for blank responses', () => {
    const result = validateIitCounsellingResponse({ response: '   ', knowledgeResults: [] });
    assert.equal(result.text, ICE_EMPTY_FALLBACK);
    assert.equal(result.reason, 'empty_response');
  });

  test('blocks rank prediction responses', () => {
    const result = validateIitCounsellingResponse({
      response: 'With rank 5000 you will definitely get CSE at IIT Delhi.',
      knowledgeResults: [
        { question: 'What is JoSAA?', answer: 'JoSAA conducts seat allocation.' },
      ],
    });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'rank_prediction_blocked');
  });

  test('blocks invented cutoff claims', () => {
    const result = validateIitCounsellingResponse({
      response: 'The closing rank is 1200 for IIT Bombay CSE this year.',
      knowledgeResults: [
        { question: 'Opening ranks?', answer: 'Published after each round on JoSAA portal.' },
      ],
    });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'rank_prediction_blocked');
  });

  test('passes grounded educational answers', () => {
    const knowledgeResults = [
      {
        question: 'What is JoSAA?',
        answer: 'JoSAA is the Joint Seat Allocation Authority for IITs, NITs, and IIITs.',
      },
    ];
    const response =
      'JoSAA is the Joint Seat Allocation Authority that allocates seats for IITs, NITs, and IIITs.';
    const result = validateIitCounsellingResponse({ response, knowledgeResults });
    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('returns unknown fallback when no grounding exists', () => {
    const result = validateIitCounsellingResponse({
      response: 'JoSAA has ten rounds every year.',
      knowledgeResults: [],
    });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'no_grounding');
  });
});
