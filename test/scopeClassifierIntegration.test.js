'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const llmReplyPath = require.resolve('../services/chatbot/llmReplyService');
const classifierPath = require.resolve('../services/chatbot/scopeFirewallHybrid/scopeClassifierService');
const scopeIntentGatePath = require.resolve('../services/chatbot/scopeFirewall/scopeIntentGate');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const REFUSAL_MARKER = "can't assist with unrelated topics";

let answerCalls;
let outboundCalls;
let structuredEvents;
let originalConsoleInfo;
let savedEnv;

function loadOrchestrator(classifierMock = null) {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];
  delete require.cache[llmReplyPath];
  delete require.cache[classifierPath];
  delete require.cache[scopeIntentGatePath];

  if (classifierMock) {
    const classifierService = require(classifierPath);
    classifierService.setScopeClassifierProviderForTests(classifierMock);
  }

  const knowledgeAssistantService = require(knowledgeAssistantPath);
  mock.method(knowledgeAssistantService, 'answerWithTimeout', async () => {
    answerCalls += 1;
    return { text: 'Mock LLM answer', model: 'test-model' };
  });

  require(llmReplyPath);
  return require(orchestratorPath);
}

function applyHooks(orchestrator) {
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

describe('scope classifier orchestrator integration', { concurrency: 1 }, () => {
  beforeEach(() => {
    answerCalls = 0;
    outboundCalls = [];
    structuredEvents = [];

    savedEnv = {
      firewall: process.env.CHATBOT_SCOPE_FIREWALL_ENABLED,
      shadow: process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE,
      classifier: process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED,
      ka: process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED,
      apiKey: process.env.LLM_API_KEY,
    };

    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = '1';
    process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED = '1';
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'https://example.com/v1';
    process.env.LLM_MODEL = 'test-model';

    originalConsoleInfo = console.info;
    console.info = (...args) => {
      const line = args.join(' ');
      if (line.includes('[chatbot:structured]')) {
        const jsonStart = line.indexOf('{');
        if (jsonStart >= 0) {
          try {
            structuredEvents.push(JSON.parse(line.slice(jsonStart)));
          } catch (_e) {
            // ignore
          }
        }
      }
    };
  });

  afterEach(() => {
    console.info = originalConsoleInfo;
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = savedEnv.firewall;
    process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = savedEnv.shadow;
    process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED = savedEnv.classifier;
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = savedEnv.ka;
    process.env.LLM_API_KEY = savedEnv.apiKey;
    if (savedEnv.firewall === undefined) delete process.env.CHATBOT_SCOPE_FIREWALL_ENABLED;
    if (savedEnv.shadow === undefined) delete process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE;
    if (savedEnv.classifier === undefined) delete process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED;
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
    const classifierService = require(classifierPath);
    classifierService.setScopeClassifierProviderForTests(null);
    delete require.cache[classifierPath];
  });

  function hasEvent(name) {
    return structuredEvents.some((e) => e.event === name);
  }

  test('classifier block prevents LLM even in shadow mode', async () => {
    const orchestrator = loadOrchestrator({
      chatCompletion: async () => ({
        text: JSON.stringify({
          allowed: false,
          category: 'programming',
          confidence: 0.97,
          reason: 'indic_code_request',
        }),
        model: 'test-model',
      }),
    });
    applyHooks(orchestrator);

    await run(orchestrator, 'पायथन कोड लिखो');

    assert.equal(answerCalls, 0, 'classifier block must not reach assistant LLM');
    assert.match(lastOutboundText(), new RegExp(REFUSAL_MARKER));
    assert.ok(hasEvent('scope_classifier_used'));
    assert.ok(hasEvent('scope_classifier_blocked'));
    assert.ok(hasEvent('scope_blocked'));
  });

  test('classifier allow reaches assistant LLM', async () => {
    const orchestrator = loadOrchestrator({
      chatCompletion: async () => ({
        text: JSON.stringify({
          allowed: true,
          category: 'career_guidance',
          confidence: 0.95,
          reason: 'exam_prep_context',
        }),
        model: 'test-model',
      }),
    });
    applyHooks(orchestrator);

    await run(orchestrator, 'p y t h o n');

    assert.equal(answerCalls, 1, 'classifier allow must reach assistant LLM');
    assert.ok(hasEvent('scope_classifier_allowed'));
  });

  test('confident counselling question skips classifier and reaches LLM', async () => {
    const orchestrator = loadOrchestrator({
      chatCompletion: async () => {
        throw new Error('classifier should not run');
      },
    });
    applyHooks(orchestrator);

    await run(orchestrator, 'Which branch is good for me?');

    assert.equal(answerCalls, 1);
    assert.ok(hasEvent('scope_allowed'));
    assert.equal(hasEvent('scope_classifier_used'), false);
  });

  test('rule-only block in shadow still reaches LLM when classifier not used', async () => {
    process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED = '0';
    delete require.cache[classifierPath];

    const orchestrator = loadOrchestrator();
    applyHooks(orchestrator);

    await run(orchestrator, 'Write Python code for sorting');

    assert.ok(hasEvent('scope_blocked_shadow'));
    assert.equal(answerCalls, 1, 'rule-only shadow block still reaches LLM');
  });
});
