'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCounsellorProgramResponse,
  CPA_EMPTY_FALLBACK,
  OSVI_BLOCKED_FALLBACK,
  COMPETITOR_BLOCKED_FALLBACK,
} = require('../services/chatbot/counsellorProgram/counsellorProgramGuardrailService');

describe('counsellorProgramGuardrailService', () => {
  test('returns human OSVI fallback', () => {
    const result = validateCounsellorProgramResponse({
      response: 'OSVI handles our backend counselling.',
      knowledgeResults: [],
    });
    assert.equal(result.text, OSVI_BLOCKED_FALLBACK);
    assert.equal(result.modified, true);
    assert.equal(result.reason, 'blocked_osvi_term');
  });

  test('returns human competitor fallback', () => {
    for (const response of [
      'We are better than CollegeDekho for IIT counselling.',
      'Compared to Shiksha, GuideXpert is cheaper.',
    ]) {
      const result = validateCounsellorProgramResponse({ response, knowledgeResults: [] });
      assert.equal(result.text, COMPETITOR_BLOCKED_FALLBACK);
      assert.equal(result.modified, true);
      assert.equal(result.reason, 'blocked_competitor_term');
    }
  });

  test('passes through grounded program answers', () => {
    const knowledgeResults = [
      {
        question: 'What is included in the IIT counselling program?',
        answer: 'Sessions cover branch selection, college shortlisting, and parent guidance.',
      },
    ];
    const response =
      'The IIT counselling program includes branch selection, college shortlisting, and parent guidance.';
    const result = validateCounsellorProgramResponse({ response, knowledgeResults });
    assert.equal(result.text, response);
    assert.equal(result.modified, false);
  });

  test('replaces empty non-identity responses with CPA empty fallback', () => {
    const result = validateCounsellorProgramResponse({ response: '   ', knowledgeResults: [] });
    assert.equal(result.text, CPA_EMPTY_FALLBACK);
    assert.equal(result.reason, 'empty_response');
  });

  test('grounds empty GuideXpert identity responses from FAQ', () => {
    const result = validateCounsellorProgramResponse({
      response: '   ',
      knowledgeResults: [],
      faqHits: [
        {
          slug: 'what-is-guidexpert',
          title: 'What is GuideXpert?',
          answer: 'GuideXpert helps students and parents with career guidance.',
        },
      ],
      userMessage: 'What is GuideXpert?',
    });
    assert.match(result.text, /GuideXpert helps students and parents/i);
    assert.equal(result.reason, 'guidexpert_identity_grounded');
  });
});
