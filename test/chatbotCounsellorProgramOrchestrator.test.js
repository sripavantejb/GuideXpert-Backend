'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const counsellorProgramPath = require.resolve(
  '../services/chatbot/counsellorProgram/counsellorProgramAssistantService'
);
const { UNKNOWN_FALLBACK } = require('../services/chatbot/counsellorProgram/counsellorProgramGuardrailService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMocks({ counsellorAnswer, knowledgeAnswer } = {}) {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];
  delete require.cache[counsellorProgramPath];

  const knowledgeAssistantService = require(knowledgeAssistantPath);
  const counsellorProgramAssistantService = require(counsellorProgramPath);

  mock.method(knowledgeAssistantService, 'answerWithTimeout', knowledgeAnswer);
  mock.method(counsellorProgramAssistantService, 'answerWithTimeout', counsellorAnswer);

  return {
    orchestrator: require(orchestratorPath),
    knowledgeAssistantService,
    counsellorProgramAssistantService,
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

describe('chatbot counsellor_program_assistant orchestration', () => {
  let outboundCalls;
  let counsellorCalls;
  let knowledgeCalls;
  let orchestrator;
  let savedCpaFlag;
  let botContext;
  let lastContextPatch;

  beforeEach(() => {
    outboundCalls = [];
    counsellorCalls = 0;
    knowledgeCalls = 0;
    botContext = {};
    lastContextPatch = null;
    savedCpaFlag = process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;

    const loaded = loadOrchestratorWithMocks({
      counsellorAnswer: async () => {
        counsellorCalls += 1;
        return { text: 'Mock program answer', model: 'test-model' };
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
    delete require.cache[counsellorProgramPath];
    if (savedCpaFlag === undefined) {
      delete process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;
    } else {
      process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = savedCpaFlag;
    }
  });

  test('uses counsellor program assistant when feature flag is enabled', async () => {
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';

    const result = await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: {
        _id: INBOUND_ID,
        text: 'What counselling services do you provide?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(counsellorCalls, 1);
    assert.equal(knowledgeCalls, 0);
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0].text, 'Mock program answer');
    assert.equal(result.outboundSuccess, true);
  });

  test('falls back to knowledge assistant when feature flag is disabled', async () => {
    delete process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;

    const result = await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: {
        _id: INBOUND_ID,
        text: 'What counselling services do you provide?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(counsellorCalls, 0);
    assert.equal(knowledgeCalls, 1);
    assert.equal(outboundCalls[0].text, 'Mock KA fallback answer');
    assert.equal(result.outboundSuccess, true);
  });

  test('uses counsellor fallback text when assistant returns no answer', async () => {
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';
    mock.restoreAll();

    const loaded = loadOrchestratorWithMocks({
      counsellorAnswer: async () => null,
      knowledgeAnswer: async () => ({ text: 'Should not be used', model: 'test-model' }),
    });
    orchestrator = loaded.orchestrator;
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

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: {
        _id: INBOUND_ID,
        text: 'What are the fees?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(outboundCalls[0].text, UNKNOWN_FALLBACK);
  });

  test('flag-off KA fallback preserves knowledgeAssistantActive for follow-ups', async () => {
    delete process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        text: 'What counselling services do you provide?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(knowledgeCalls, 1);
    assert.equal(counsellorCalls, 0);
    assert.equal(lastContextPatch?.knowledgeAssistantActive, true);
    assert.equal(lastContextPatch?.counsellorProgramAssistantActive, false);

    await orchestrator.processInbound({
      conversation: makeConversation(),
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        text: 'How long does it last?',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(knowledgeCalls, 2);
    assert.equal(counsellorCalls, 0);
    assert.equal(lastContextPatch?.knowledgeAssistantActive, true);
  });

  test('multi-turn CPA conversation sends one outbound per message and keeps CPA session', async () => {
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';

    const messages = [
      'what counselling programs do you provide',
      'fees',
      'benefits',
      'mentorship',
      'duration',
    ];

    for (const text of messages) {
      await orchestrator.processInbound({
        conversation: makeConversation(),
        inbound: {
          _id: new mongoose.Types.ObjectId(),
          text,
          messageType: 'text',
        },
        leadLinks: [],
      });
    }

    assert.equal(outboundCalls.length, messages.length);
    assert.equal(counsellorCalls, messages.length);
    assert.equal(knowledgeCalls, 0);
    assert.equal(lastContextPatch?.counsellorProgramAssistantActive, true);
    assert.equal(lastContextPatch?.knowledgeAssistantActive, false);
  });
});
