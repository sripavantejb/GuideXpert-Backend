'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const outboundPath = require.resolve('../services/chatbot/whatsappOutboundService');
const gupshupSessionPath = require.resolve('../services/chatbot/gupshupSessionService');
const outboundModelPath = require.resolve('../models/WhatsAppOutboundMessage');
const sessionFallbackPath = require.resolve('../services/chatbot/sessionFallbackService');

describe('sendAgentTextReply delivery', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[outboundPath];
    delete require.cache[gupshupSessionPath];
    delete require.cache[outboundModelPath];
    delete require.cache[sessionFallbackPath];
  });

  test('uses session fallback on re-engagement errors', async () => {
    const WhatsAppOutboundMessage = require(outboundModelPath);
    const outboundId = new mongoose.Types.ObjectId();
    const conversationId = new mongoose.Types.ObjectId();

    mock.method(WhatsAppOutboundMessage, 'create', async () => ({
      _id: outboundId,
      conversationId,
      phone: '9876543210',
    }));
    mock.method(WhatsAppOutboundMessage, 'updateOne', async () => ({}));

    const gupshupSession = require(gupshupSessionPath);
    mock.method(gupshupSession, 'sendTextMessage', async () => ({
      success: false,
      error: 'Re-engagement message: 131047',
    }));

    const sessionFallback = require(sessionFallbackPath);
    mock.method(sessionFallback, 'sendSessionInactiveTemplateFallback', async () => ({
      success: true,
    }));

    delete require.cache[outboundPath];
    const { sendAgentTextReply } = require(outboundPath);
    const result = await sendAgentTextReply({
      conversationId,
      phone10: '9876543210',
      text: 'Hello from counsellor',
      senderAdminId: new mongoose.Types.ObjectId(),
      handoffId: new mongoose.Types.ObjectId(),
    });

    assert.equal(result.success, true);
    assert.equal(result.sessionFallback, true);
    assert.equal(result.providerStatus, 'submitted');
  });
});
