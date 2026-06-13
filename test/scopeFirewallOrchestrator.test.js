'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const llmReplyPath = require.resolve('../services/chatbot/llmReplyService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

const REFUSAL_MARKER = "GuideXpert's counselling assistant";

let answerCalls;
let outboundCalls;
let structuredEvents;
let originalConsoleInfo;
let savedEnv;

function loadOrchestrator() {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];
  delete require.cache[llmReplyPath];

  const knowledgeAssistantService = require(knowledgeAssistantPath);
  mock.method(knowledgeAssistantService, 'answerWithTimeout', async () => {
    answerCalls += 1;
    return { text: 'Mock LLM answer', model: 'test-model' };
  });

  // llmReplyService destructures answerWithTimeout, so it must be reloaded
  // after the mock is applied to route unknown-intent traffic through the mock.
  require(llmReplyPath);

  return require(orchestratorPath);
}

function applyHooks(orchestrator, { knowledgeAssistantActive = false } = {}) {
  orchestrator.setChatbotOrchestratorTestHooks({
    buildLeadContext: async () => ({ productLine: 'unknown' }),
    retrieveFacts: async () => ({ links: [] }),
    getBotState: async () => ({
      state: 'idle',
      context: knowledgeAssistantActive ? { knowledgeAssistantActive: true } : {},
    }),
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
}

function makeConversation() {
  return { _id: CONVERSATION_ID, phone: '9876543210', productLine: 'unknown', status: 'active' };
}

function run(orchestrator, text) {
  return orchestrator.processInbound({
    conversation: makeConversation(),
    inbound: { _id: INBOUND_ID, text, messageType: 'text' },
    leadLinks: [],
  });
}

function lastOutboundText() {
  return outboundCalls.length ? outboundCalls[outboundCalls.length - 1].text : null;
}

describe('scope firewall orchestration', () => {
  beforeEach(() => {
    answerCalls = 0;
    outboundCalls = [];
    structuredEvents = [];

    savedEnv = {
      enabled: process.env.CHATBOT_SCOPE_FIREWALL_ENABLED,
      shadow: process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE,
      ka: process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED,
      apiKey: process.env.LLM_API_KEY,
    };

    // Enable the LLM path so allowed messages reach the (mocked) assistant.
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    originalConsoleInfo = console.info;
    console.info = (...args) => {
      const line = args.join(' ');
      if (line.includes('[chatbot:structured]')) {
        const jsonStart = line.indexOf('{');
        if (jsonStart >= 0) {
          try {
            structuredEvents.push(JSON.parse(line.slice(jsonStart)));
          } catch (_e) {
            // ignore non-JSON structured lines
          }
        }
      }
    };
  });

  afterEach(() => {
    console.info = originalConsoleInfo;
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = savedEnv.enabled;
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = savedEnv.shadow;
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = savedEnv.ka;
    process.env.LLM_API_KEY = savedEnv.apiKey;
    if (savedEnv.enabled === undefined) delete process.env.CHATBOT_SCOPE_FIREWALL_ENABLED;
    if (savedEnv.shadow === undefined) delete process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE;
    if (savedEnv.ka === undefined) delete process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED;
    if (savedEnv.apiKey === undefined) delete process.env.LLM_API_KEY;

    const orchestrator = require(orchestratorPath);
    if (orchestrator.setChatbotOrchestratorTestHooks) {
      orchestrator.setChatbotOrchestratorTestHooks(null);
    }
    mock.restoreAll();
    delete require.cache[orchestratorPath];
    delete require.cache[knowledgeAssistantPath];
    delete require.cache[llmReplyPath];
  });

  function hasEvent(name) {
    return structuredEvents.some((e) => e.event === name);
  }

  test('enforcement: programming question is blocked, no LLM call', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = '0';
    const orchestrator = loadOrchestrator();
    applyHooks(orchestrator);

    await run(orchestrator, 'Write Python code for sorting');

    assert.equal(answerCalls, 0, 'LLM/provider must not be called for a blocked message');
    assert.equal(outboundCalls.length, 1);
    assert.match(lastOutboundText(), new RegExp(REFUSAL_MARKER));
    assert.ok(hasEvent('scope_blocked'));
  });

  test('enforcement: weather, image and movie questions are blocked', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = '0';
    const orchestrator = loadOrchestrator();
    applyHooks(orchestrator);

    for (const text of [
      'What is the weather today?',
      'Generate an image of a dog',
      'Tell me about Avengers movie',
    ]) {
      outboundCalls = [];
      answerCalls = 0;
      await run(orchestrator, text);
      assert.equal(answerCalls, 0, `LLM must not be called for "${text}"`);
      assert.match(lastOutboundText(), new RegExp(REFUSAL_MARKER), `"${text}" should be refused`);
    }
  });

  test('enforcement: sticky KA session + programming is still blocked', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = '0';
    const orchestrator = loadOrchestrator();
    applyHooks(orchestrator, { knowledgeAssistantActive: true });

    await run(orchestrator, 'Write Python code for sorting');

    assert.equal(answerCalls, 0, 'sticky KA session must not bypass the firewall');
    assert.match(lastOutboundText(), new RegExp(REFUSAL_MARKER));
  });

  test('shadow mode: programming question logs but is NOT blocked', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = '1';
    const orchestrator = loadOrchestrator();
    applyHooks(orchestrator);

    await run(orchestrator, 'Write Python code for sorting');

    assert.ok(hasEvent('scope_blocked_shadow'), 'shadow block must be logged');
    assert.equal(answerCalls, 1, 'shadow mode must still reach the LLM');
    assert.doesNotMatch(lastOutboundText() || '', new RegExp(REFUSAL_MARKER));
  });

  test('allowed: counselling question reaches the LLM', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = '0';
    const orchestrator = loadOrchestrator();
    applyHooks(orchestrator);

    await run(orchestrator, 'Which branch is good for me?');

    assert.equal(answerCalls, 1, 'allowed counselling question must reach the LLM');
    assert.doesNotMatch(lastOutboundText() || '', new RegExp(REFUSAL_MARKER));
    assert.ok(hasEvent('scope_allowed'));
  });
});
