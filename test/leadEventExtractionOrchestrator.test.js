'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const extractionPath = require.resolve('../services/chatbot/leadEventExtraction/leadEventExtractionService');
const cpaPath = require.resolve('../services/chatbot/counsellorProgram/counsellorProgramAssistantService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const OUTBOUND_ID = new mongoose.Types.ObjectId();

describe('lead event extraction orchestrator hook', () => {
  let extractionCalls;
  let outboundCalls;
  let orchestrator;
  let savedFlag;
  let savedCpaFlag;
  let extractionImpl;

  function makeHooks() {
    return {
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
          return { success: true, outboundId: OUTBOUND_ID };
        },
      },
    };
  }

  function loadOrchestrator() {
    delete require.cache[orchestratorPath];
    delete require.cache[extractionPath];
    delete require.cache[cpaPath];

    const cpaService = require(cpaPath);
    mock.method(cpaService, 'answerWithTimeout', async () => ({
      text: 'GuideXpert is a counselling mentorship program for aspirants.',
      model: 'test-model',
    }));

    const extractionService = require(extractionPath);
    mock.method(extractionService, 'extractAndPersist', (params) => {
      extractionCalls.push(params);
      return extractionImpl(params);
    });

    orchestrator = require(orchestratorPath);
    orchestrator.setChatbotOrchestratorTestHooks(makeHooks());
  }

  beforeEach(() => {
    extractionCalls = [];
    outboundCalls = [];
    extractionImpl = async () => null;
    savedFlag = process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED;
    savedCpaFlag = process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;
    loadOrchestrator();
  });

  afterEach(() => {
    orchestrator.setChatbotOrchestratorTestHooks(null);
    mock.restoreAll();
    delete require.cache[orchestratorPath];
    delete require.cache[extractionPath];
    delete require.cache[cpaPath];

    if (savedFlag === undefined) {
      delete process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED;
    } else {
      process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = savedFlag;
    }
    if (savedCpaFlag === undefined) {
      delete process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;
    } else {
      process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = savedCpaFlag;
    }
  });

  async function runInbound() {
    return orchestrator.processInbound({
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'unknown',
        status: 'active',
      },
      inbound: { _id: INBOUND_ID, text: 'What is GuideXpert?', messageType: 'text' },
      leadLinks: { phone10: '9876543210' },
    });
  }

  test('does not call extraction when feature flag is off', async () => {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '0';
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    const result = await runInbound();

    assert.equal(extractionCalls.length, 0);
    assert.equal(outboundCalls.length, 1);
    assert.equal(result.outboundSuccess, true);
  });

  test('calls extraction with expected payload when feature flag is on', async () => {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '1';
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    await runInbound();

    assert.equal(extractionCalls.length, 1);
    assert.equal(String(extractionCalls[0].conversation._id), String(CONVERSATION_ID));
    assert.equal(String(extractionCalls[0].inbound._id), String(INBOUND_ID));
    assert.equal(String(extractionCalls[0].outboundMessageId), String(OUTBOUND_ID));
    assert.equal(extractionCalls[0].intent, 'counsellor_program_assistant');
    assert.match(extractionCalls[0].assistantReply, /GuideXpert is a counselling mentorship program/);
  });

  test('extraction failures do not block reply flow', async () => {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '1';
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    extractionImpl = async () => Promise.reject(new Error('boom'));
    loadOrchestrator();

    const result = await runInbound();

    assert.equal(result.outboundSuccess, true);
    assert.equal(outboundCalls.length, 1);
  });

  test('does not await slow extraction before returning', async () => {
    process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED = '1';
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    let resolveExtraction;
    let extractionPromise;
    extractionImpl = () => {
      extractionPromise = new Promise((resolve) => {
        resolveExtraction = resolve;
      });
      return extractionPromise;
    };
    loadOrchestrator();

    const result = await runInbound();

    assert.equal(extractionCalls.length, 1);
    assert.equal(outboundCalls.length, 1);
    assert.equal(result.outboundSuccess, true);

    resolveExtraction(null);
    await extractionPromise;
  });
});
