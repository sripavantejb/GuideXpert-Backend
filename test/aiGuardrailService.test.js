'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  OPPORTUNITY_FALLBACK,
  UNKNOWN_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
  extractPartnershipClaims,
  extractCompanyTieupClaims,
  extractMentorNameClaims,
  validateAiResponse,
} = require('../services/chatbot/aiGuardrailService');

const GENERIC_KB = [
  {
    question: 'What exactly is NIAT?',
    answer:
      'NIAT collaborates with different universities to provide an industry-aligned learning experience.',
  },
];

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

  test('blocks invented placement percentages', () => {
    const result = validateAiResponse({
      response: 'NIAT has 95% placements.',
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result.reason, 'unsupported_numeric_claim');
  });

  test('blocks invented salary figures', () => {
    const result = validateAiResponse({
      response: 'Average package is 50 LPA.',
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
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

  test('blocks invented partnerships', () => {
    const result = validateAiResponse({
      response: 'NIAT partnered with Google.',
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result.reason, 'unsupported_partnership_claim');
  });

  test('blocks invented company tie-ups', () => {
    const result = validateAiResponse({
      response: 'Internships happen at Microsoft.',
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result.reason, 'unsupported_company_tieup_claim');
  });

  test('blocks invented mentor names', () => {
    const result = validateAiResponse({
      response: 'You will be guided by mentor Rahul Sharma.',
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result.reason, 'unsupported_mentor_claim');
  });

  test('allows KB-supported partnership language', () => {
    const response = 'NIAT collaborates with different universities.';
    const result = validateAiResponse({
      response,
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('allows user-provided rank echoed in assistant response', () => {
    const response = 'With rank 15000, CSE may be possible in some colleges depending on the exam.';
    const result = validateAiResponse({
      response,
      userMessage: 'Can I get CSE with rank 15000?',
      englishUserMessage: 'Can I get CSE with rank 15000?',
      knowledgeResults: [],
    });

    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('allows Telugu rank question numbers in user allowlist', () => {
    const response = 'CSE around rank 15000 depends on the college and category.';
    const result = validateAiResponse({
      response,
      userMessage: '15000 rank tho CSE vastunda?',
      englishUserMessage: 'Can I get CSE with rank 15000?',
      knowledgeResults: [],
    });

    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('allows user-provided percentile in assistant response', () => {
    const response = 'At 97.8 percentile, options depend on the exam and category.';
    const result = validateAiResponse({
      response,
      userMessage: '97.8 percentile',
      englishUserMessage: '97.8 percentile',
      knowledgeResults: [],
    });

    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('still blocks invented numbers when user did not provide them', () => {
    const result = validateAiResponse({
      response: 'NIAT has 95% placements.',
      userMessage: 'Tell me about NIAT',
      englishUserMessage: 'Tell me about NIAT',
      knowledgeResults: GENERIC_KB,
    });

    assert.equal(result.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result.reason, 'unsupported_numeric_claim');
  });
});

describe('aiGuardrailService extractors', () => {
  test('extractPartnershipClaims captures partner entities', () => {
    assert.deepEqual(extractPartnershipClaims('NIAT partnered with Google.'), ['Google']);
  });

  test('extractCompanyTieupClaims captures company entities', () => {
    assert.deepEqual(extractCompanyTieupClaims('Internship at Microsoft.'), ['Microsoft']);
  });

  test('extractMentorNameClaims captures mentor names', () => {
    assert.deepEqual(extractMentorNameClaims('Guided by mentor Rahul Sharma.'), ['Rahul Sharma']);
  });
});
