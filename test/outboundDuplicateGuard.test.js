'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const outboundServicePath = require.resolve('../services/chatbot/whatsappOutboundService');
const gupshupSessionPath = require.resolve('../services/chatbot/gupshupSessionService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const EXISTING_OUTBOUND_ID = new mongoose.Types.ObjectId();

describe('sendBotTextReply duplicate guard', () => {
  let sendCalls;
  let createCalls;

  beforeEach(() => {
    sendCalls = 0;
    createCalls = 0;

    delete require.cache[outboundServicePath];
    delete require.cache[gupshupSessionPath];

    const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
    mock.method(WhatsAppOutboundMessage, 'findOne', (query) => ({
      select() {
        return {
          lean: async () => {
            if (
              query.inReplyToInboundId &&
              String(query.inReplyToInboundId) === String(INBOUND_ID) &&
              query.senderType === 'bot' &&
              query.status?.$in
            ) {
              return {
                _id: EXISTING_OUTBOUND_ID,
                status: 'submitted',
              };
            }
            return null;
          },
        };
      },
      lean: async () => {
        if (
          query.inReplyToInboundId &&
          String(query.inReplyToInboundId) === String(INBOUND_ID) &&
          query.senderType === 'bot' &&
          query.status?.$in
        ) {
          return {
            _id: EXISTING_OUTBOUND_ID,
            status: 'submitted',
          };
        }
        return null;
      },
    }));
    mock.method(WhatsAppOutboundMessage, 'create', async () => {
      createCalls += 1;
      return {
        _id: new mongoose.Types.ObjectId(),
        status: 'queued',
      };
    });
    mock.method(WhatsAppOutboundMessage, 'updateOne', async () => ({ acknowledged: true }));

    const gupshupSession = require(gupshupSessionPath);
    mock.method(gupshupSession, 'sendTextMessage', async () => {
      sendCalls += 1;
      return { success: true, data: { messageId: 'msg-1' } };
    });
  });

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[outboundServicePath];
    delete require.cache[gupshupSessionPath];
  });

  test('does not send WhatsApp message when successful bot reply already exists', async () => {
    const outbound = require(outboundServicePath);
    const result = await outbound.sendBotTextReply({
      conversationId: CONVERSATION_ID,
      phone10: '9876543210',
      text: 'Duplicate should be blocked',
      inReplyToInboundId: INBOUND_ID,
    });

    assert.equal(result.success, true);
    assert.equal(result.duplicatePrevented, true);
    assert.equal(String(result.outboundId), String(EXISTING_OUTBOUND_ID));
    assert.equal(sendCalls, 0);
    assert.equal(createCalls, 0);
  });
});

describe('WhatsAppOutboundMessage bot reply index', () => {
  test('schema defines unique partial index on inReplyToInboundId for bot sender', () => {
    const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
    const indexes = WhatsAppOutboundMessage.schema.indexes();
    const botReplyIndex = indexes.find(
      ([fields]) =>
        fields &&
        Object.keys(fields).length === 1 &&
        fields.inReplyToInboundId === 1
    );

    assert.ok(botReplyIndex, 'expected inReplyToInboundId index');
    const options = botReplyIndex[1] || {};
    assert.equal(options.unique, true);
    assert.equal(options.partialFilterExpression?.senderType, 'bot');
  });
});
