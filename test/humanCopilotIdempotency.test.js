'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const outboundPath = require.resolve('../services/chatbot/whatsappOutboundService');
const outboundModelPath = require.resolve('../models/WhatsAppOutboundMessage');
const gupshupPath = require.resolve('../services/chatbot/gupshupSessionService');

describe('agent outbound idempotency', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[outboundPath];
  });

  test('sendAgentTextReply returns existing outbound for same copilotReplyId', async () => {
    const REPLY_ID = '507f1f77bcf86cd799439012';
    const OUTBOUND_ID = '507f1f77bcf86cd799439013';

    const WhatsAppOutboundMessage = require(outboundModelPath);
    mock.method(WhatsAppOutboundMessage, 'findOne', () => ({
      lean: async () => ({
        _id: OUTBOUND_ID,
        status: 'submitted',
      }),
    }));
    const createCalls = [];
    mock.method(WhatsAppOutboundMessage, 'create', async (doc) => {
      createCalls.push(doc);
      return { _id: 'new' };
    });

    const gupshupSession = require(gupshupPath);
    mock.method(gupshupSession, 'sendTextMessage', async () => ({ success: true, data: {} }));

    const { sendAgentTextReply } = require(outboundPath);
    const result = await sendAgentTextReply({
      conversationId: '507f1f77bcf86cd799439011',
      phone10: '9347763131',
      text: 'Hello',
      copilotReplyId: REPLY_ID,
    });

    assert.equal(result.success, true);
    assert.equal(result.duplicatePrevented, true);
    assert.equal(String(result.outboundId), OUTBOUND_ID);
    assert.equal(createCalls.length, 0);
  });
});
