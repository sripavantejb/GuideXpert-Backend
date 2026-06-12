'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/leadEventExtraction/leadEventExtractionService');
const profileServicePath = require.resolve('../services/chatbot/leadProfile/leadProfileService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const historyPath = require.resolve('../services/chatbot/conversationHistoryService');
const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const modelPath = require.resolve('../models/WhatsAppLeadEvent');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const OUTBOUND_ID = new mongoose.Types.ObjectId();

describe('lead profile integration at extraction boundary', () => {
  const originalEnv = {
    extraction: process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED,
    profile: process.env.CHATBOT_LEAD_PROFILE_ENABLED,
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[profileServicePath];
    delete require.cache[providerPath];
    delete require.cache[historyPath];
    delete require.cache[logPath];

    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey =
        key === 'extraction'
          ? 'CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED'
          : key === 'profile'
            ? 'CHATBOT_LEAD_PROFILE_ENABLED'
            : key === 'apiKey'
              ? 'LLM_API_KEY'
              : key === 'baseUrl'
                ? 'LLM_BASE_URL'
                : 'LLM_MODEL';
      if (value === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = value;
      }
    }
  });

  function baseParams() {
    return {
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
      },
      inbound: {
        _id: INBOUND_ID,
        phone: '9876543210',
        text: 'I want CSE at IIT Bombay',
      },
      outboundMessageId: OUTBOUND_ID,
      intent: 'iit_counselling_expert',
      intentReason: 'iit_counselling_question',
      userMessage: 'I want CSE at IIT Bombay',
      assistantReply: 'CSE at IIT Bombay is highly competitive.',
      leadContext: { productLine: 'iit_counselling' },
      contextPatch: { iitCounsellingExpertActive: true },
    };
  }

  function setupExtractionMocks({ llmText, profileImpl } = {}) {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '1';
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'https://example.test/v1';
    process.env.LLM_MODEL = 'test-model';

    delete require.cache[historyPath];
    const historyService = require(historyPath);
    mock.method(historyService, 'getConversationHistory', async () => []);

    const WhatsAppLeadEvent = require(modelPath);
    mock.method(WhatsAppLeadEvent, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
    }));
    mock.method(WhatsAppLeadEvent, 'create', async (doc) => ({
      _id: new mongoose.Types.ObjectId(),
      ...doc,
    }));

    delete require.cache[providerPath];
    const { OpenAiCompatibleProvider } = require(providerPath);
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => ({
      text: llmText,
      model: 'test-model',
    }));

    delete require.cache[logPath];
    const logModule = require(logPath);
    mock.method(logModule, 'logChatbotEvent', () => {});

    delete require.cache[profileServicePath];
    const profileService = require(profileServicePath);
    const profileCalls = [];
    mock.method(profileService, 'updateProfile', async (args) => {
      profileCalls.push(args);
      if (profileImpl) {
        return profileImpl(args);
      }
      return { eventCount: args.events.length };
    });

    delete require.cache[servicePath];
    const { extractAndPersist } = require(servicePath);

    return { extractAndPersist, profileCalls, WhatsAppLeadEvent };
  }

  test('calls updateProfile after successful event persist when both flags on', async () => {
    const llmText = JSON.stringify({
      events: [
        {
          type: 'branch_preference',
          value: 'CSE',
          confidence: 0.9,
          evidence: 'I want CSE',
        },
        {
          type: 'college_preference',
          value: 'IIT Bombay',
          confidence: 0.88,
          evidence: 'IIT Bombay',
        },
      ],
    });
    const { extractAndPersist, profileCalls } = setupExtractionMocks({ llmText });

    const result = await extractAndPersist(baseParams());

    assert.ok(result);
    assert.equal(result.events.length, 2);
    assert.equal(profileCalls.length, 1);
    assert.equal(profileCalls[0].phone, '9876543210');
    assert.equal(profileCalls[0].conversationId, CONVERSATION_ID);
    assert.equal(profileCalls[0].events.length, 2);
    assert.equal(profileCalls[0].assistantType, 'ice');
    assert.equal(String(profileCalls[0].inboundMessageId), String(INBOUND_ID));
  });

  test('skips updateProfile when profile flag is off', async () => {
    const llmText = JSON.stringify({
      events: [
        {
          type: 'exam_mentioned',
          value: 'JEE',
          confidence: 0.9,
          evidence: 'JEE',
        },
      ],
    });
    const { extractAndPersist, profileCalls, WhatsAppLeadEvent } = setupExtractionMocks({ llmText });
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '0';
    delete require.cache[servicePath];
    const { extractAndPersist: extractReloaded } = require(servicePath);

    const result = await extractReloaded(baseParams());

    assert.ok(result);
    assert.equal(WhatsAppLeadEvent.create.mock.calls.length, 1);
    assert.equal(profileCalls.length, 0);
  });

  test('extraction succeeds when updateProfile rejects', async () => {
    const llmText = JSON.stringify({
      events: [
        {
          type: 'demo_interest',
          value: 'yes',
          confidence: 0.95,
          evidence: 'book demo',
        },
      ],
    });
    const { extractAndPersist } = setupExtractionMocks({
      llmText,
      profileImpl: async () => {
        throw new Error('profile write failed');
      },
    });

    const result = await extractAndPersist(baseParams());

    assert.ok(result);
    assert.equal(result.events[0].type, 'demo_interest');
  });

  test('extraction flag off behavior unchanged', async () => {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '0';
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';

    delete require.cache[profileServicePath];
    const profileService = require(profileServicePath);
    let profileCalled = false;
    mock.method(profileService, 'updateProfile', async () => {
      profileCalled = true;
      return null;
    });

    delete require.cache[servicePath];
    const { extractAndPersist } = require(servicePath);
    const result = await extractAndPersist(baseParams());

    assert.equal(result, null);
    assert.equal(profileCalled, false);
  });
});
