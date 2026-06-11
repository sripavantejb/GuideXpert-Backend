'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const iitExpertPath = require.resolve(
  '../services/chatbot/iitCounsellingExpert/iitCounsellingExpertService'
);

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMocks({ iitAnswer, knowledgeAnswer } = {}) {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];
  delete require.cache[iitExpertPath];

  const knowledgeAssistantService = require(knowledgeAssistantPath);
  const iitCounsellingExpertService = require(iitExpertPath);

  mock.method(knowledgeAssistantService, 'answerWithTimeout', knowledgeAnswer);
  mock.method(iitCounsellingExpertService, 'answerWithTimeout', iitAnswer);

  return {
    orchestrator: require(orchestratorPath),
    knowledgeAssistantService,
    iitCounsellingExpertService,
  };
}

function makeConversation() {
  return {
    _id: CONVERSATION_ID,
    phone: '9876543210',
    productLine: 'unknown',
    status: 'active',
  };
}

describe('chatbot iit_counselling_expert orchestration', () => {
  let outboundCalls;
  let iitCalls;
  let knowledgeCalls;
  let orchestrator;
  let savedFlag;
  let botContext;
  let lastContextPatch;

  beforeEach(() => {
    outboundCalls = [];
    iitCalls = 0;
    knowledgeCalls = 0;
    botContext = {};
    lastContextPatch = null;
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;

    const loaded = loadOrchestratorWithMocks({
      iitAnswer: async () => {
        iitCalls += 1;
        return { text: 'Mock IIT counselling answer', model: 'test-model' };
      },
      knowledgeAnswer: async () => {
        knowledgeCalls += 1;
        return { text: 'Mock KA fallback answer', model: 'test-model' };
      },
    });
    orchestrator = loaded.orchestrator;

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
    delete require.cache[iitExpertPath];
    if (savedFlag === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = savedFlag;
    }
  });

  test('uses IIT counselling expert when feature flag is enabled', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: { _id: INBOUND_ID, text: 'What is JoSAA?', messageType: 'text' },
      leadLinks: [],
    });

    assert.equal(iitCalls, 1);
    assert.equal(knowledgeCalls, 0);
    assert.equal(outboundCalls.length, 1);
    assert.match(outboundCalls[0].text, /Mock IIT counselling answer/);
    assert.equal(lastContextPatch?.iitCounsellingExpertActive, true);
  });

  test('falls back to knowledge assistant when feature flag is disabled', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '0';

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: { _id: INBOUND_ID, text: 'What is JoSAA?', messageType: 'text' },
      leadLinks: [],
    });

    assert.equal(iitCalls, 0);
    assert.equal(knowledgeCalls, 1);
    assert.notEqual(lastContextPatch?.iitCounsellingExpertActive, true);
  });

  test('multi-turn JoSAA session stays on IIT expert', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: { _id: new mongoose.Types.ObjectId(), text: 'What is JoSAA?', messageType: 'text' },
      leadLinks: [],
    });
    assert.equal(lastContextPatch?.iitCounsellingExpertActive, true);

    for (const text of ['How many rounds are there?', 'float', 'slide']) {
      await orchestrator.processInbound({
        conversation: makeConversation(),
        inbound: { _id: new mongoose.Types.ObjectId(), text, messageType: 'text' },
        leadLinks: [],
      });
      assert.equal(lastContextPatch?.iitCounsellingExpertActive, true, text);
    }

    assert.equal(iitCalls, 4);
  });
});
