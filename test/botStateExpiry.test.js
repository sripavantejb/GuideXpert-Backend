'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { isStateExpired, SUBFLOW_TTL_MS } = require('../services/chatbot/botStateService');

describe('botStateExpiry', () => {
  test('isStateExpired respects stateExpiresAt', () => {
    assert.equal(isStateExpired({ stateExpiresAt: new Date(Date.now() - 1000) }), true);
    assert.equal(isStateExpired({ stateExpiresAt: new Date(Date.now() + 60000) }), false);
    assert.equal(isStateExpired({}), false);
    assert.equal(SUBFLOW_TTL_MS, 30 * 60 * 1000);
  });
});
