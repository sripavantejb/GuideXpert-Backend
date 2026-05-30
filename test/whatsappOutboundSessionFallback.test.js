'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { isReengagementSendError } = require('../services/chatbot/whatsappOutboundService');

describe('whatsappOutbound session fallback', () => {
  test('isReengagementSendError detects re-engagement and 131047', () => {
    assert.equal(isReengagementSendError('Re-engagement message'), true);
    assert.equal(isReengagementSendError('Error 131047: re-engagement required'), true);
    assert.equal(isReengagementSendError('Gupshup not configured'), false);
  });
});
