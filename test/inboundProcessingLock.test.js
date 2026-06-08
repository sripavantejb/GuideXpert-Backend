'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const inboundServicePath = require.resolve('../services/chatbot/whatsappInboundService');
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');

const INBOUND_ID = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();

describe('inbound processing lock', () => {
  let processInboundCalls;
  let inboundUpdates;

  beforeEach(() => {
    processInboundCalls = 0;
    inboundUpdates = [];

    delete require.cache[inboundServicePath];
    delete require.cache[orchestratorPath];

    const orchestrator = require(orchestratorPath);
    mock.method(orchestrator, 'processInbound', async () => {
      processInboundCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { success: true, outboundSuccess: true, delivered: true };
    });

    const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
    let claimAttempts = 0;
    mock.method(WhatsAppInboundMessage, 'findOneAndUpdate', async (filter) => {
      if (filter.processStatus !== 'pending') {
        return null;
      }
      claimAttempts += 1;
      if (claimAttempts === 1) {
        return {
          _id: INBOUND_ID,
          conversationId: CONVERSATION_ID,
          phone: '9876543210',
          text: 'hello',
          processStatus: 'processing',
        };
      }
      return null;
    });
    mock.method(WhatsAppInboundMessage, 'updateOne', async (filter, update) => {
      inboundUpdates.push({ filter, update });
      return { acknowledged: true };
    });
  });

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[inboundServicePath];
    delete require.cache[orchestratorPath];
  });

  test('claimInboundForProcessing only succeeds once for pending row', async () => {
    const inboundService = require(inboundServicePath);
    const first = await inboundService.claimInboundForProcessing(INBOUND_ID);
    const second = await inboundService.claimInboundForProcessing(INBOUND_ID);

    assert.ok(first);
    assert.equal(second, null);
  });

  test('executeClaimedInboundProcessing skips when claim fails', async () => {
    delete require.cache[inboundServicePath];
    const inboundService = require(inboundServicePath);
    const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
    const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
    mock.method(WhatsAppInboundMessage, 'findOneAndUpdate', async () => null);
    mock.method(WhatsAppOutboundMessage, 'findOne', () => ({
      select() {
        return {
          lean: async () => null,
        };
      },
      lean: async () => null,
    }));

    const result = await inboundService.executeClaimedInboundProcessing({
      conversation: { _id: CONVERSATION_ID, phone: '9876543210' },
      inbound: { _id: INBOUND_ID },
      leadLinks: [],
      phone10: '9876543210',
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_processing');
    assert.equal(processInboundCalls, 0);
  });

  test('executeClaimedInboundProcessing runs processInbound after successful claim', async () => {
    const inboundService = require(inboundServicePath);
    const result = await inboundService.executeClaimedInboundProcessing({
      conversation: { _id: CONVERSATION_ID, phone: '9876543210' },
      inbound: { _id: INBOUND_ID },
      leadLinks: [],
      phone10: '9876543210',
    });

    assert.equal(processInboundCalls, 1);
    assert.equal(result.outboundSuccess, true);
    assert.ok(
      inboundUpdates.some(
        (entry) => entry.update?.$set?.processStatus === 'processed'
      )
    );
  });
});

describe('romanized Hindi capability probe', () => {
  const PROBE =
    'Tum mere liye kya kya kar sakte konse tareeke me our kithne tariko me';

  test('detects hi and routes capability_question intent', async () => {
    const { detectLanguage } = require('../services/language/languageDetectionService');
    const { classifyIntent } = require('../services/chatbot/intentClassifierService');

    const det = await detectLanguage({ message: PROBE });
    assert.equal(det.language, 'hi');
    assert.notEqual(det.language, 'en');

    const intent = classifyIntent(
      PROBE,
      { state: 'idle', context: {} },
      'unknown',
      PROBE
    );
    assert.equal(intent.intent, 'knowledge_assistant');
    assert.equal(intent.intentReason, 'capability_question');
  });
});
