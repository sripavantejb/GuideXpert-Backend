'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { logChatbotEvent } = require('../services/chatbot/chatbotStructuredLog');

describe('chatbotStructuredLog', () => {
  test('emits required schema fields as JSON', () => {
    const lines = [];
    const orig = console.info;
    console.info = (_tag, line) => lines.push(line);
    try {
      logChatbotEvent('inbound_processed', {
        conversationId: '507f1f77bcf86cd799439011',
        phone10: '9876543210',
        intent: 'college_predictor',
        botState: 'main_menu',
        productLine: 'iit_counselling',
        predictorExam: 'TS_EAMCET',
        upstreamStatus: null,
        durationMs: 42,
      });
      assert.equal(lines.length, 1);
      const payload = JSON.parse(lines[0]);
      assert.equal(payload.event, 'inbound_processed');
      assert.equal(payload.conversationId, '507f1f77bcf86cd799439011');
      assert.equal(payload.phoneTail, '****3210');
      assert.equal(payload.intent, 'college_predictor');
      assert.equal(payload.botState, 'main_menu');
      assert.equal(payload.productLine, 'iit_counselling');
      assert.equal(payload.predictorExam, 'TS_EAMCET');
      assert.equal(payload.upstreamStatus, null);
      assert.equal(payload.durationMs, 42);
      assert.equal(payload.GUPSHUP_WEBHOOK_SECRET, undefined);
    } finally {
      console.info = orig;
    }
  });
});
