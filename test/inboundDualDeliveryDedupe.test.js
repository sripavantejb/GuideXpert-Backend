'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const inboundServicePath = require.resolve('../services/chatbot/whatsappInboundService');
const conversationServicePath = require.resolve('../services/chatbot/conversationService');
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const WEBHOOK_ID = new mongoose.Types.ObjectId();

function gupshupHiBody(providerId) {
  return {
    type: 'message',
    timestamp: Math.floor(Date.now() / 1000),
    payload: {
      source: '919876543210',
      id: providerId,
      payload: { type: 'text', text: 'hi' },
    },
  };
}

function metaHiBody(providerId) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: '919876543210',
                  id: providerId,
                  type: 'text',
                  text: { body: 'hi' },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('inbound dual-delivery dedupe', () => {
  let processInboundCalls;
  let inboundCreateCalls;
  let webhookCreateCalls;
  let existingRecentInbound;
  let webhookKeys;
  let prevAuthRequired;

  beforeEach(() => {
    processInboundCalls = 0;
    inboundCreateCalls = 0;
    webhookCreateCalls = 0;
    existingRecentInbound = null;
    webhookKeys = new Set();
    prevAuthRequired = process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED;
    process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED = '0';

    delete require.cache[inboundServicePath];
    delete require.cache[conversationServicePath];
    delete require.cache[orchestratorPath];

    const orchestrator = require(orchestratorPath);
    mock.method(orchestrator, 'processInbound', async () => {
      processInboundCalls += 1;
      return { success: true, outboundSuccess: true, delivered: true };
    });

    const conversationService = require(conversationServicePath);
    mock.method(conversationService, 'getOrCreateConversation', async () => ({
      conversation: { _id: CONVERSATION_ID, phone: '9876543210' },
      leadLinks: {},
    }));
    mock.method(conversationService, 'touchInbound', async () => {});

    const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
    mock.method(WhatsAppInboundMessage, 'find', () => ({
      select() {
        return {
          sort() {
            return {
              limit() {
                return {
                  lean: async () => (existingRecentInbound ? [existingRecentInbound] : []),
                };
              },
            };
          },
        };
      },
    }));
    mock.method(WhatsAppInboundMessage, 'create', async () => {
      inboundCreateCalls += 1;
      return {
        _id: INBOUND_ID,
        conversationId: CONVERSATION_ID,
        phone: '9876543210',
        text: 'hi',
        processStatus: 'pending',
      };
    });
    mock.method(WhatsAppInboundMessage, 'findOneAndUpdate', async () => ({
      _id: INBOUND_ID,
      conversationId: CONVERSATION_ID,
      phone: '9876543210',
      text: 'hi',
      processStatus: 'processing',
    }));
    mock.method(WhatsAppInboundMessage, 'updateOne', async () => ({ acknowledged: true }));

    const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
    mock.method(WhatsAppOutboundMessage, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
      lean: async () => null,
    }));

    const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
    mock.method(WhatsAppWebhookEvent, 'create', async (doc) => {
      webhookCreateCalls += 1;
      const key = doc.webhookDedupeKey;
      if (webhookKeys.has(key)) {
        const err = new Error('E11000 duplicate key error');
        err.code = 11000;
        throw err;
      }
      webhookKeys.add(key);
      return { _id: WEBHOOK_ID, ...doc };
    });
    mock.method(WhatsAppWebhookEvent, 'updateOne', async () => ({ acknowledged: true }));
  });

  afterEach(() => {
    mock.restoreAll();
    if (prevAuthRequired === undefined) {
      delete process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED;
    } else {
      process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED = prevAuthRequired;
    }
    delete require.cache[inboundServicePath];
    delete require.cache[conversationServicePath];
    delete require.cache[orchestratorPath];
  });

  test('second dual-delivery webhook is deduped and does not process again', async () => {
    const inboundService = require(inboundServicePath);
    const receivedAt = new Date();

    const first = await inboundService.handleInboundWebhook(
      { headers: {} },
      gupshupHiBody('gupshup-msg-1'),
      receivedAt
    );
    const second = await inboundService.handleInboundWebhook(
      { headers: {} },
      metaHiBody('wamid.META-DUPLICATE'),
      receivedAt
    );

    assert.equal(first.handled, true);
    assert.equal(first.dedupe, undefined);
    assert.ok(first.inboundId);

    assert.equal(second.handled, true);
    assert.equal(second.dedupe, true);
    assert.equal(processInboundCalls, 1);
    assert.equal(inboundCreateCalls, 1);
    assert.equal(webhookCreateCalls, 2);
  });

  test('recent same utterance is deduped even with different provider ids', async () => {
    existingRecentInbound = {
      _id: new mongoose.Types.ObjectId(),
      text: 'Hi',
      receivedAt: new Date(),
    };

    const inboundService = require(inboundServicePath);
    const result = await inboundService.handleInboundWebhook(
      { headers: {} },
      metaHiBody('wamid.LATE-RETRY'),
      new Date()
    );

    assert.equal(result.handled, true);
    assert.equal(result.dedupe, true);
    assert.equal(result.reason, 'recent_same_utterance');
    assert.equal(processInboundCalls, 0);
    assert.equal(inboundCreateCalls, 0);
    assert.equal(webhookCreateCalls, 0);
  });

  test('short permission ack "yes" is NOT cross-turn deduped', async () => {
    existingRecentInbound = {
      _id: new mongoose.Types.ObjectId(),
      text: 'yes',
      receivedAt: new Date(),
    };

    const inboundService = require(inboundServicePath);
    const result = await inboundService.handleInboundWebhook(
      { headers: {} },
      {
        type: 'message',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          source: '919876543210',
          id: 'gupshup-yes-stage5',
          payload: { type: 'text', text: 'yes' },
        },
      },
      new Date()
    );

    assert.equal(result.dedupe, undefined);
    assert.equal(result.reason, undefined);
    assert.equal(processInboundCalls, 1);
    assert.equal(inboundCreateCalls, 1);
  });
});
