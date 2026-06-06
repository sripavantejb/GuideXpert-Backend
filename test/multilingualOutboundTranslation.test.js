'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const llmReplyPath = require.resolve('../services/chatbot/llmReplyService');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');
const structuredLogPath = require.resolve('../services/chatbot/chatbotStructuredLog');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

const TABLE_REPLY = [
  '| Branch | Why it can be a good choice | What you will learn |',
  '| --- | --- | --- |',
  '| **CSE** | Good for software jobs. <br>• Strong demand | Coding and algorithms |',
  '| **ECE** | Good for hardware and IoT | Electronics and embedded systems |',
  '',
  '### How to decide',
  '',
  '1. Think about your interests.',
].join('\n');

function loadOrchestratorWithMocks({
  prepareMultilingualInbound,
  finalizeMultilingualOutbound,
  tryLlmReply,
  onLogEvent,
} = {}) {
  [
    orchestratorPath,
    middlewarePath,
    llmReplyPath,
    conversationLangPath,
    structuredLogPath,
  ].forEach((path) => delete require.cache[path]);

  const structuredLog = require(structuredLogPath);
  if (onLogEvent) {
    mock.method(structuredLog, 'logChatbotEvent', onLogEvent);
  }

  const middleware = require(middlewarePath);
  if (prepareMultilingualInbound) {
    mock.method(middleware, 'prepareMultilingualInbound', prepareMultilingualInbound);
  }
  if (finalizeMultilingualOutbound) {
    mock.method(middleware, 'finalizeMultilingualOutbound', finalizeMultilingualOutbound);
  }

  const conversationLang = require(conversationLangPath);
  mock.method(conversationLang, 'seedPreferredLanguageFromLead', async () => null);
  mock.method(conversationLang, 'recordDetectedLanguage', async () => {});

  if (tryLlmReply) {
    const llmReplyService = require(llmReplyPath);
    mock.method(llmReplyService, 'tryLlmReply', tryLlmReply);
  }

  return require(orchestratorPath);
}

describe('multilingual outbound translation with WhatsApp formatting', () => {
  let outboundCalls;
  let finalizeInput;
  let loggedEvents;
  let orchestrator;

  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    outboundCalls = [];
    finalizeInput = null;
    loggedEvents = [];

    orchestrator = loadOrchestratorWithMocks({
      prepareMultilingualInbound: async () => ({
        originalMessage: 'నాకు ఏ బ్రాంచ్ మంచిది?',
        englishMessage: 'Which branch is good for me?',
        language: 'te',
        detectedLanguage: 'te',
        confidence: 0.9,
        translationApplied: true,
        resolvedLanguage: 'te',
        detectionSource: 'offline',
      }),
      finalizeMultilingualOutbound: async (args) => {
        finalizeInput = args.englishResponse;
        if (args.outboundTrace) {
          Object.assign(args.outboundTrace, {
            outboundTranslationExecuted: true,
            translateFromEnglishExecuted: true,
            outboundTranslationLanguage: 'te',
            outboundTranslationPassThrough: false,
            translatedResponsePreview: 'Telugu branch guidance',
          });
        }
        return 'Telugu branch guidance';
      },
      tryLlmReply: async () => ({
        text: TABLE_REPLY,
        model: 'test-model',
        guardrailModified: false,
        languageLog: {
          englishResponse: TABLE_REPLY,
          resultIds: ['kb-1'],
        },
      }),
      onLogEvent: (event, payload) => {
        loggedEvents.push({ event, payload });
      },
    });

    orchestrator.setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({ productLine: 'iit_counselling' }),
      retrieveFacts: async () => ({ links: [] }),
      getBotState: async () => ({ state: 'idle', context: {} }),
      transitionState: async () => {},
      isBotPausedForConversation: async () => false,
      createHandoff: async () => {},
      cancelActiveHandoffForUser: async () => {},
      updateConversationIntent: async () => {},
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push(args);
          return { success: true };
        },
      },
    });
  });

  afterEach(() => {
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    delete process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED;
    orchestrator.setChatbotOrchestratorTestHooks(null);
    mock.restoreAll();
    [
      orchestratorPath,
      middlewarePath,
      llmReplyPath,
      conversationLangPath,
      structuredLogPath,
    ].forEach((path) => delete require.cache[path]);
  });

  test('sanitizes markdown before outbound translation and logs trace fields', async () => {
    await orchestrator.processInbound({
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
        status: 'active',
      },
      inbound: {
        _id: INBOUND_ID,
        text: 'నాకు ఏ బ్రాంచ్ మంచిది?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.ok(finalizeInput);
    assert.doesNotMatch(finalizeInput, /\|/);
    assert.doesNotMatch(finalizeInput, /###/);
    assert.doesNotMatch(finalizeInput, /<br/i);
    assert.match(finalizeInput, /^CSE$/m);

    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0].text, 'Telugu branch guidance');

    const processed = loggedEvents.find((entry) => entry.event === 'inbound_processed');
    assert.ok(processed);
    assert.equal(processed.payload.detectedLanguage, 'te');
    assert.equal(processed.payload.resolvedLanguage, 'te');
    assert.equal(processed.payload.shouldTranslateOutbound, true);
    assert.equal(processed.payload.outboundTranslationExecuted, true);
    assert.equal(processed.payload.translateFromEnglishExecuted, true);
    assert.equal(processed.payload.outboundLanguage, 'te');
    assert.equal(processed.payload.knowledgeAssistantResponse, TABLE_REPLY);
  });
});
