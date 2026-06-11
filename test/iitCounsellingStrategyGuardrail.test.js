'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateIitCounsellingStrategyResponse,
  ICS_EMPTY_FALLBACK,
  UNKNOWN_FALLBACK,
} = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyGuardrailService');

describe('iitCounsellingStrategyGuardrailService', () => {
  test('returns empty fallback for blank responses', () => {
    const result = validateIitCounsellingStrategyResponse({ response: '   ', knowledgeResults: [] });
    assert.equal(result.text, ICS_EMPTY_FALLBACK);
    assert.equal(result.reason, 'empty_response');
  });

  test('blocks rank prediction responses', () => {
    const result = validateIitCounsellingStrategyResponse({
      response: 'With rank 5000 you will definitely get CSE at IIT Delhi.',
      knowledgeResults: [
        { question: 'CSE vs ECE?', answer: 'Compare interests and official data.' },
      ],
    });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'rank_prediction_blocked');
  });

  test('blocks fabricated cutoff claims', () => {
    const result = validateIitCounsellingStrategyResponse({
      response: 'The closing rank is 1200 for IIT Bombay CSE this year.',
      knowledgeResults: [
        { question: 'Branch strategy?', answer: 'Use official JoSAA opening and closing ranks.' },
      ],
    });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'rank_prediction_blocked');
  });

  test('passes grounded strategic answers', () => {
    const knowledgeResults = [
      {
        question: 'Should I choose CSE or ECE?',
        answer: 'Choose CSE for software focus; ECE for electronics and embedded paths.',
      },
    ];
    const response =
      'If coding is your main interest, CSE is usually the better fit. ECE suits students drawn to electronics and embedded systems.';
    const result = validateIitCounsellingStrategyResponse({ response, knowledgeResults });
    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('rejects generic coding assistant responses', () => {
    const result = validateIitCounsellingStrategyResponse({
      response: 'Yes, I can help you with coding questions.',
      knowledgeResults: [
        {
          question: 'Coding pasand ho to — which branch should I choose?',
          answer: 'If you like coding, CSE or IT is usually the better fit.',
        },
      ],
    });
    assert.equal(result.text, '');
    assert.equal(result.reason, 'generic_assistant_rejected');
  });

  test('returns unknown fallback when no grounding exists', () => {
    const result = validateIitCounsellingStrategyResponse({
      response: 'Always choose IIT Bombay CSE.',
      knowledgeResults: [],
    });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'no_grounding');
  });
});
