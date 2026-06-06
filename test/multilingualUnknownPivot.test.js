'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const llmReplyPath = require.resolve('../services/chatbot/llmReplyService');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMocks({
  prepareMultilingualInbound,
  finalizeMultilingualOutbound,
  tryLlmReply,
} = {}) {
  [
    orchestratorPath,
    middlewarePath,
    llmReplyPath,
    conversationLangPath,
  ].forEach((path) => delete require.cache[path]);

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

describe('multilingual unknown pivot', () => {
  let outboundCalls;
  let llmInboundText;
  let finalizeCalls;
  let orchestrator;

  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    outboundCalls = [];
    llmInboundText = null;
    finalizeCalls = 0;

    orchestrator = loadOrchestratorWithMocks({
      prepareMultilingualInbound: async () => ({
        originalMessage: 'నాకు ఏ branch బాగుంటుంది?',
        englishMessage: 'Which branch is good for me?',
        language: 'te',
        detectedLanguage: 'te',
        confidence: 0.9,
        translationApplied: true,
        resolvedLanguage: 'te',
      }),
      finalizeMultilingualOutbound: async (args) => {
        finalizeCalls += 1;
        return `Telugu: ${args.englishResponse}`;
      },
      tryLlmReply: async ({ inboundText }) => {
        llmInboundText = inboundText;
        return { text: 'CSE is a strong option if you enjoy technology and problem solving.' };
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
    ].forEach((path) => delete require.cache[path]);
  });

  test('unknown intent uses englishMessage for tryLlmReply and translates outbound', async () => {
    await orchestrator.processInbound({
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
        status: 'active',
      },
      inbound: {
        _id: INBOUND_ID,
        text: 'నాకు ఏ branch బాగుంటుంది?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(llmInboundText, 'Which branch is good for me?');
    assert.equal(finalizeCalls, 1);
    assert.match(outboundCalls[0].text, /^Telugu: /);
  });
});

describe('greeting orchestration', () => {
  let outboundCalls;
  let orchestrator;

  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    outboundCalls = [];

    orchestrator = loadOrchestratorWithMocks({
      prepareMultilingualInbound: async ({ message }) => ({
        originalMessage: message,
        englishMessage: 'how are you?',
        language: 'te',
        detectedLanguage: 'te',
        confidence: 0.9,
        translationApplied: true,
        resolvedLanguage: 'te',
      }),
    });

    orchestrator.setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({
        productLine: 'iit_counselling',
        iit: { preferredLanguage: 'Telugu' },
      }),
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
    orchestrator.setChatbotOrchestratorTestHooks(null);
    mock.restoreAll();
    [
      orchestratorPath,
      middlewarePath,
      llmReplyPath,
      conversationLangPath,
    ].forEach((path) => delete require.cache[path]);
  });

  test('ela vunnaru sends localized greeting without knowledge assistant', async () => {
    await orchestrator.processInbound({
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
        status: 'active',
      },
      inbound: {
        _id: INBOUND_ID,
        text: 'ela vunnaru',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.match(outboundCalls[0].text, /బాగున్నాను/);
  });
});
