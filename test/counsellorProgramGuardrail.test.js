'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCounsellorProgramResponse,
  UNKNOWN_FALLBACK,
} = require('../services/chatbot/counsellorProgram/counsellorProgramGuardrailService');

describe('counsellorProgramGuardrailService', () => {
  test('blocks OSVI and competitor mentions', () => {
    for (const response of [
      'OSVI handles our backend counselling.',
      'We are better than CollegeDekho for IIT counselling.',
      'Compared to Shiksha, GuideXpert is cheaper.',
    ]) {
      const result = validateCounsellorProgramResponse({ response, knowledgeResults: [] });
      assert.equal(result.text, UNKNOWN_FALLBACK);
      assert.equal(result.modified, true);
      assert.equal(result.reason, 'blocked_term');
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

  test('replaces empty responses with fallback', () => {
    const result = validateCounsellorProgramResponse({ response: '   ', knowledgeResults: [] });
    assert.equal(result.text, UNKNOWN_FALLBACK);
    assert.equal(result.reason, 'empty_response');
  });
});
