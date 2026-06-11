'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const strategyPath = require.resolve(
  '../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyService'
);
const icePath = require.resolve(
  '../services/chatbot/iitCounsellingExpert/iitCounsellingExpertService'
);

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMocks({ strategyAnswer, iceAnswer, knowledgeAnswer } = {}) {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];
  delete require.cache[strategyPath];
  delete require.cache[icePath];

  const knowledgeAssistantService = require(knowledgeAssistantPath);
  const strategyService = require(strategyPath);
  const iceService = require(icePath);

  mock.method(knowledgeAssistantService, 'answerWithTimeout', knowledgeAnswer);
  mock.method(strategyService, 'answerWithTimeout', strategyAnswer);
  mock.method(iceService, 'answerWithTimeout', iceAnswer);

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

describe('chatbot iit_counselling_strategy orchestration', () => {
  let outboundCalls;
  let strategyCalls;
  let iceCalls;
  let knowledgeCalls;
  let orchestrator;
  let savedIceFlag;
  let savedStrategyFlag;
  let botContext;
  let lastContextPatch;

  beforeEach(() => {
    outboundCalls = [];
    strategyCalls = 0;
    iceCalls = 0;
    knowledgeCalls = 0;
    botContext = {};
    lastContextPatch = null;
    savedIceFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    savedStrategyFlag = process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;

    orchestrator = loadOrchestratorWithMocks({
      strategyAnswer: async () => {
        strategyCalls += 1;
        return { text: 'Mock strategy answer', model: 'test-model' };
      },
      iceAnswer: async () => {
        iceCalls += 1;
        return { text: 'Mock ICE answer', model: 'test-model' };
      },
      knowledgeAnswer: async () => {
        knowledgeCalls += 1;
        return { text: 'Mock KA fallback answer', model: 'test-model' };
      },
    });

    orchestrator.setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({ productLine: 'unknown' }),
      retrieveFacts: async () => ({ links: [] }),
      getBotState: async () => ({ state: 'idle', context: { ...botContext } }),
      transitionState: async (_id, _phone, _state, contextPatch) => {
        lastContextPatch = contextPatch;
        botContext = { ...contextPatch };
      },
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
    delete require.cache[strategyPath];
    delete require.cache[icePath];
    if (savedIceFlag === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = savedIceFlag;
    }
    if (savedStrategyFlag === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = savedStrategyFlag;
    }
  });

  test('routes CSE vs ECE to strategy service when flags enabled', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: { _id: INBOUND_ID, text: 'CSE vs ECE?', messageType: 'text' },
      leadLinks: [],
    });

    assert.equal(strategyCalls, 1);
    assert.equal(iceCalls, 0);
    assert.equal(outboundCalls.length, 1);
    assert.match(outboundCalls[0].text, /Mock strategy answer/);
    assert.equal(lastContextPatch?.iitCounsellingStrategyActive, true);
    assert.notEqual(lastContextPatch?.iitCounsellingExpertActive, true);
  });

  test('does not use strategy service when strategy flag disabled', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '0';

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: { _id: INBOUND_ID, text: 'CSE vs ECE?', messageType: 'text' },
      leadLinks: [],
    });

    assert.equal(strategyCalls, 0);
    assert.notEqual(lastContextPatch?.iitCounsellingStrategyActive, true);
    assert.equal(outboundCalls.length, 1);
  });

  test('multi-turn strategy session keeps strategy active on follow-up', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';
    botContext = { iitCounsellingStrategyActive: true };

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: { _id: new mongoose.Types.ObjectId(), text: 'What if I like coding?', messageType: 'text' },
      leadLinks: [],
    });

    assert.equal(strategyCalls, 1);
    assert.equal(lastContextPatch?.iitCounsellingStrategyActive, true);
  });
});
