'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMockedAssistant(mockAnswerWithTimeout) {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];

  const knowledgeAssistantService = require(knowledgeAssistantPath);
  mock.method(knowledgeAssistantService, 'answerWithTimeout', mockAnswerWithTimeout);

  return require(orchestratorPath);
}

function makeConversation() {
  return {
    _id: CONVERSATION_ID,
    phone: '9876543210',
    productLine: 'unknown',
    status: 'active',
  };
}

describe('chatbot knowledge_assistant orchestration', () => {
  let outboundCalls;
  let answerCalls;
  let orchestrator;

  beforeEach(() => {
    outboundCalls = [];
    answerCalls = 0;

    orchestrator = loadOrchestratorWithMockedAssistant(async (params) => {
      answerCalls += 1;
      return { text: 'Mock NIAT answer', model: 'test-model' };
    });

    orchestrator.setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({ productLine: 'unknown' }),
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
    orchestrator.setChatbotOrchestratorTestHooks(null);
    mock.restoreAll();
    delete require.cache[orchestratorPath];
    delete require.cache[knowledgeAssistantPath];
  });

  test('routes knowledge questions through answerWithTimeout and sends the reply', async () => {
    const result = await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: {
        _id: INBOUND_ID,
        text: 'What is NIAT?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(answerCalls, 1);
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0].text, 'Mock NIAT answer');
    assert.equal(result.outboundSuccess, true);
  });

  test('orchestrator source does not reference undefined knowledgeAssistantAnswer', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../services/chatbot/chatbotOrchestratorService.js'),
      'utf8'
    );
    assert.doesNotMatch(source, /\bknowledgeAssistantAnswer\b/);
    assert.match(source, /\banswerWithTimeout\b/);
  });
});
