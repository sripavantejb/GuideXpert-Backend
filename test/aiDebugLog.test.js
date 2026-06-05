'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const { isAiDebugEnabled, aiDebugLog } = require('../services/chatbot/aiDebugLog');

const ORIGINAL_DEBUG_AI = process.env.DEBUG_AI;

afterEach(() => {
  mock.restoreAll();
  if (ORIGINAL_DEBUG_AI === undefined) {
    delete process.env.DEBUG_AI;
  } else {
    process.env.DEBUG_AI = ORIGINAL_DEBUG_AI;
  }
});

describe('aiDebugLog', () => {
  test('isAiDebugEnabled is false by default', () => {
    delete process.env.DEBUG_AI;
    assert.equal(isAiDebugEnabled(), false);
  });

  test('aiDebugLog is a no-op when DEBUG_AI is not true', () => {
    delete process.env.DEBUG_AI;
    const logMock = mock.method(console, 'log', () => {});

    aiDebugLog('KB', 'hidden message');

    assert.equal(logMock.mock.callCount(), 0);
  });

  test('aiDebugLog writes tagged output when DEBUG_AI=true', () => {
    process.env.DEBUG_AI = 'true';
    const logMock = mock.method(console, 'log', () => {});

    aiDebugLog('GUARDRAIL', 'Reason:', 'unsupported_partnership_claim');

    assert.equal(logMock.mock.callCount(), 1);
    assert.deepEqual(logMock.mock.calls[0].arguments, [
      '[GUARDRAIL]',
      'Reason:',
      'unsupported_partnership_claim',
    ]);
  });
});
