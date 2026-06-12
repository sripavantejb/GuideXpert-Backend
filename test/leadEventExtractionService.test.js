'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/leadEventExtraction/leadEventExtractionService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const historyPath = require.resolve('../services/chatbot/conversationHistoryService');
const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const modelPath = require.resolve('../models/WhatsAppLeadEvent');
const validatorPath = require.resolve('../services/chatbot/leadEventExtraction/leadEventSchemaValidator');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const OUTBOUND_ID = new mongoose.Types.ObjectId();

describe('leadEventExtractionService', () => {
  const originalEnv = {
    enabled: process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED,
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[providerPath];
    delete require.cache[historyPath];
    delete require.cache[logPath];

    if (originalEnv.enabled === undefined) {
      delete process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED;
    } else {
      process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = originalEnv.enabled;
    }
    if (originalEnv.apiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalEnv.apiKey;
    }
    if (originalEnv.baseUrl === undefined) {
      delete process.env.LLM_BASE_URL;
    } else {
      process.env.LLM_BASE_URL = originalEnv.baseUrl;
    }
    if (originalEnv.model === undefined) {
      delete process.env.LLM_MODEL;
    } else {
      process.env.LLM_MODEL = originalEnv.model;
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
        text: 'What is JoSAA?',
      },
      outboundMessageId: OUTBOUND_ID,
      intent: 'iit_counselling_expert',
      intentReason: 'iit_counselling_question',
      userMessage: 'What is JoSAA?',
      assistantReply: 'JoSAA conducts seat allocation for IITs and NITs.',
      leadContext: { productLine: 'iit_counselling' },
      contextPatch: { iitCounsellingExpertActive: true },
    };
  }

  function mockHappyPath({ llmText, existing = null } = {}) {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'https://example.test/v1';
    process.env.LLM_MODEL = 'test-model';

    delete require.cache[historyPath];
    const historyService = require(historyPath);
    mock.method(historyService, 'getConversationHistory', async () => [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);

    const WhatsAppLeadEvent = require(modelPath);
    mock.method(WhatsAppLeadEvent, 'findOne', () => ({
      select() {
        return { lean: async () => existing };
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

    return { WhatsAppLeadEvent, logModule };
  }

  test('does nothing when feature flag is off', async () => {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '0';
    delete require.cache[providerPath];
    const { OpenAiCompatibleProvider } = require(providerPath);
    let called = false;
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => {
      called = true;
      return { text: '{}' };
    });

    const { extractAndPersist } = require(servicePath);
    const result = await extractAndPersist(baseParams());
    assert.equal(result, null);
    assert.equal(called, false);
  });

  test('persists validated events when flag is on', async () => {
    const llmText = JSON.stringify({
      events: [
        {
          type: 'counselling_stage_question',
          value: 'JoSAA',
          confidence: 0.92,
          evidence: 'User asked What is JoSAA?',
        },
      ],
    });
    const { WhatsAppLeadEvent } = mockHappyPath({ llmText });

    const { extractAndPersist } = require(servicePath);
    const result = await extractAndPersist(baseParams());

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'counselling_stage_question');
    assert.equal(WhatsAppLeadEvent.create.mock.calls.length, 1);
  });

  test('skips duplicate inbound messages', async () => {
    let llmCalls = 0;
    mockHappyPath({
      existing: { _id: new mongoose.Types.ObjectId() },
      llmText: JSON.stringify({ events: [] }),
    });
    delete require.cache[providerPath];
    const { OpenAiCompatibleProvider } = require(providerPath);
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => {
      llmCalls += 1;
      return { text: '{}' };
    });

    const { extractAndPersist } = require(servicePath);
    const result = await extractAndPersist(baseParams());
    assert.equal(result, null);
    assert.equal(llmCalls, 0);
  });

  test('filters invalid and low-confidence events without throwing', async () => {
    const llmText = JSON.stringify({
      events: [
        {
          type: 'unknown_type',
          value: 'x',
          confidence: 0.9,
          evidence: 'bad type',
        },
        {
          type: 'branch_preference',
          value: 'CSE',
          confidence: 0.2,
          evidence: 'too low',
        },
      ],
    });
    const { WhatsAppLeadEvent, logModule } = mockHappyPath({ llmText });

    const { extractAndPersist } = require(servicePath);
    const result = await extractAndPersist(baseParams());

    assert.equal(result, null);
    assert.equal(WhatsAppLeadEvent.create.mock.calls.length, 0);
    assert.equal(logModule.logChatbotEvent.mock.calls.length, 1);
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[0], 'lead_event_extracted');
  });

  test('handles invalid JSON without throwing', async () => {
    const { WhatsAppLeadEvent, logModule } = mockHappyPath({ llmText: 'not-json' });

    const { extractAndPersist } = require(servicePath);
    const result = await extractAndPersist(baseParams());

    assert.equal(result, null);
    assert.equal(WhatsAppLeadEvent.create.mock.calls.length, 0);
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[0], 'lead_event_extracted');
  });

  test('validateExtractedEvents accepts known event types', () => {
    const { validateExtractedEvents } = require(validatorPath);
    const result = validateExtractedEvents(
      JSON.stringify({
        events: [
          {
            type: 'rank_mentioned',
            value: '15000',
            confidence: 0.88,
            evidence: 'My rank is 15000',
          },
        ],
      })
    );
    assert.equal(result.valid, true);
    assert.equal(result.events.length, 1);
  });
});
