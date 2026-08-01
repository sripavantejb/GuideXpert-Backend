'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/llmOnlyChatService');
const promptSettingsPath = require.resolve('../utils/systemPromptSettings');
const llmClientPath = require.resolve('../services/ai/llmClient');
const outboundPath = require.resolve('../services/chatbot/whatsappOutboundService');
const botStatePath = require.resolve('../services/chatbot/botStateService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function emptyQueryChain(result = []) {
  const chain = {
    sort: () => chain,
    limit: () => chain,
    select: () => chain,
    lean: async () => result,
  };
  return chain;
}

describe('llmOnlyChatService', () => {
  let sentTexts;
  let llmCalls;
  let botContext;
  let transitions;
  let dbPrompt;

  beforeEach(() => {
    sentTexts = [];
    llmCalls = [];
    transitions = [];
    botContext = {};
    dbPrompt = { text: 'ADMIN PANEL PROMPT' };

    for (const p of [servicePath, promptSettingsPath, llmClientPath, outboundPath, botStatePath]) {
      delete require.cache[p];
    }

    const promptSettings = require(promptSettingsPath);
    mock.method(promptSettings, 'getSystemPromptSetting', async () => dbPrompt);

    const llmClient = require(llmClientPath);
    mock.method(llmClient, 'chatCompletion', async (args) => {
      llmCalls.push(args);
      return { content: 'LLM REPLY', model: 'test', usage: null };
    });

    const outbound = require(outboundPath);
    mock.method(outbound, 'sendBotTextReply', async ({ text }) => {
      sentTexts.push(text);
      return { success: true };
    });

    const botState = require(botStatePath);
    mock.method(botState, 'getBotState', async () => ({ context: botContext }));
    mock.method(botState, 'transitionState', async (_id, _phone, _state, patch) => {
      transitions.push(patch);
      Object.assign(botContext, patch);
    });

    const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
    mock.method(WhatsAppInboundMessage, 'find', () => emptyQueryChain([]));
    const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
    mock.method(WhatsAppOutboundMessage, 'find', () => emptyQueryChain([]));
  });

  afterEach(() => {
    mock.restoreAll();
  });

  function svc() {
    delete require.cache[servicePath];
    return require(servicePath);
  }

  const conversation = { _id: CONVERSATION_ID, phone: '9876543210' };
  const inbound = (text) => ({ _id: INBOUND_ID, text });

  test('normal message: reply comes from OpenAI using the admin panel prompt verbatim', async () => {
    const result = await svc().processInbound({ conversation, inbound: inbound('hello') });

    assert.equal(result.outboundSuccess, true);
    assert.equal(result.llmUsed, true);
    assert.equal(llmCalls.length, 1);
    assert.equal(llmCalls[0].messages[0].role, 'system');
    assert.equal(llmCalls[0].messages[0].content, 'ADMIN PANEL PROMPT');
    assert.equal(llmCalls[0].messages.at(-1).content, 'hello');
    assert.deepEqual(sentTexts, ['LLM REPLY']);
  });

  test('STOP opts the user out and sends confirmation without calling the LLM', async () => {
    const service = svc();
    const result = await service.processInbound({ conversation, inbound: inbound('STOP') });

    assert.equal(result.optOut, true);
    assert.equal(llmCalls.length, 0);
    assert.deepEqual(transitions, [{ optedOut: true }]);
    assert.deepEqual(sentTexts, [service.OPT_OUT_REPLY]);
  });

  test('opted-out user gets no reply until START', async () => {
    botContext.optedOut = true;
    const result = await svc().processInbound({ conversation, inbound: inbound('hi again') });

    assert.equal(result.suppressed, true);
    assert.equal(llmCalls.length, 0);
    assert.equal(sentTexts.length, 0);
  });

  test('START resumes an opted-out user and replies via LLM', async () => {
    botContext.optedOut = true;
    const result = await svc().processInbound({ conversation, inbound: inbound('START') });

    assert.equal(result.llmUsed, true);
    assert.deepEqual(transitions, [{ optedOut: false }]);
    assert.deepEqual(sentTexts, ['LLM REPLY']);
  });

  test('LLM failure still sends a safe error reply', async () => {
    const llmClient = require(llmClientPath);
    mock.method(llmClient, 'chatCompletion', async () => {
      throw new Error('provider down');
    });

    const service = svc();
    const result = await service.processInbound({ conversation, inbound: inbound('hello') });

    assert.equal(result.llmUsed, false);
    assert.deepEqual(sentTexts, [service.ERROR_REPLY]);
  });
});
