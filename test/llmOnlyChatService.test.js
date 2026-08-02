'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/llmOnlyChatService');
const promptSettingsPath = require.resolve('../utils/systemPromptSettings');
const llmClientPath = require.resolve('../services/ai/llmClient');
const outboundPath = require.resolve('../services/chatbot/whatsappOutboundService');
const botStatePath = require.resolve('../services/chatbot/botStateService');
const memoryPath = require.resolve('../services/chatbot/leadProfileMemoryService');
const predictorPath = require.resolve('../services/chatbot/predictorToolService');

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

function replyCall(llmCalls) {
  return llmCalls.find(
    (c) =>
      Array.isArray(c.messages) &&
      c.messages.some((m) => m.role === 'system' && m.content === 'ADMIN PANEL PROMPT')
  );
}

function knownProfileMessage(call) {
  return (call?.messages || []).find(
    (m) => m.role === 'system' && String(m.content || '').startsWith('KNOWN_PROFILE')
  );
}

function checklistMessage(call) {
  return (call?.messages || []).find(
    (m) => m.role === 'system' && String(m.content || '').startsWith('PREDICTOR_CHECKLIST')
  );
}

describe('llmOnlyChatService', () => {
  let sentTexts;
  let llmCalls;
  let botContext;
  let transitions;
  let dbPrompt;
  let inboundFindQueries;
  let outboundFindQueries;
  let prevHistorySince;
  let extractPatch;
  let predictorIntent;
  let predictorSlotPatch;
  let collegeRunCount;
  let rankRunCount;

  beforeEach(() => {
    sentTexts = [];
    llmCalls = [];
    transitions = [];
    botContext = {};
    dbPrompt = { text: 'ADMIN PANEL PROMPT' };
    inboundFindQueries = [];
    outboundFindQueries = [];
    extractPatch = {};
    predictorIntent = null;
    predictorSlotPatch = {};
    collegeRunCount = 0;
    rankRunCount = 0;
    prevHistorySince = process.env.CHATBOT_HISTORY_SINCE;
    delete process.env.CHATBOT_HISTORY_SINCE;

    for (const p of [
      servicePath,
      promptSettingsPath,
      llmClientPath,
      outboundPath,
      botStatePath,
      memoryPath,
      predictorPath,
    ]) {
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
    mock.method(botState, 'getBotState', async () => ({
      state: 'idle',
      context: botContext,
    }));
    mock.method(botState, 'transitionState', async (_id, _phone, _state, patch) => {
      transitions.push(patch);
      Object.assign(botContext, patch);
    });

    const memory = require(memoryPath);
    mock.method(memory, 'extractProfilePatch', async () => extractPatch);

    const predictor = require(predictorPath);
    mock.method(predictor, 'detectPredictorIntent', () => predictorIntent);
    mock.method(predictor, 'extractPredictorSlotPatch', async () => predictorSlotPatch);
    mock.method(predictor, 'buildCollegeSlotsFromProfile', () => ({}));
    mock.method(predictor, 'buildRankSlotsFromProfile', () => ({}));
    mock.method(predictor, 'mergeCollegeSlots', ({ slots }) => ({ ...slots, ...(predictorSlotPatch.slots || {}) }));
    mock.method(predictor, 'mergeRankSlots', ({ slots }) => ({ ...slots, ...(predictorSlotPatch.slots || {}) }));
    mock.method(predictor, 'buildPredictorChecklistBlock', (session) =>
      [
        'PREDICTOR_CHECKLIST',
        `type: ${session.type}`,
        'next_to_ask: rank',
        'Ask ONLY for next_to_ask',
      ].join('\n')
    );
    mock.method(predictor, 'isSessionActive', (p) => Boolean(p && p.active));
    mock.method(predictor, 'isSessionReady', (session) => Boolean(session?.slots?.__ready));
    mock.method(predictor, 'runCollegePrediction', async () => {
      collegeRunCount += 1;
      return { ok: true, reply: 'COLLEGE PREDICTION RESULT' };
    });
    mock.method(predictor, 'runRankPrediction', async () => {
      rankRunCount += 1;
      return { ok: true, reply: 'RANK PREDICTION RESULT' };
    });
    mock.method(predictor, 'emptyPredictorSession', (type) => ({
      active: true,
      type,
      slots: {},
    }));

    const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
    mock.method(WhatsAppInboundMessage, 'find', (query) => {
      inboundFindQueries.push(query);
      return emptyQueryChain([]);
    });
    const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
    mock.method(WhatsAppOutboundMessage, 'find', (query) => {
      outboundFindQueries.push(query);
      return emptyQueryChain([]);
    });
  });

  afterEach(() => {
    mock.restoreAll();
    if (prevHistorySince === undefined) delete process.env.CHATBOT_HISTORY_SINCE;
    else process.env.CHATBOT_HISTORY_SINCE = prevHistorySince;
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
    const main = replyCall(llmCalls);
    assert.ok(main, 'main reply LLM call missing');
    assert.equal(main.messages[0].role, 'system');
    assert.equal(main.messages[0].content, 'ADMIN PANEL PROMPT');
    assert.equal(main.messages.at(-1).content, 'hello');
    assert.ok(knownProfileMessage(main), 'KNOWN_PROFILE system message missing');
    assert.equal(checklistMessage(main), undefined);
    assert.equal(collegeRunCount, 0);
    assert.deepEqual(sentTexts, ['LLM REPLY']);
  });

  test('KNOWN_PROFILE includes previously stored facts and merged extraction patch', async () => {
    botContext.leadProfile = {
      qualification: '12th - MPC',
      city_pref: 'Hyderabad',
    };
    extractPatch = { budget: '3 lakhs', course_interest: 'CSE' };

    const result = await svc().processInbound({
      conversation,
      inbound: inbound('budget around 3 lakhs, want cse'),
    });

    assert.equal(result.leadProfile.qualification, '12th - MPC');
    assert.equal(result.leadProfile.city_pref, 'Hyderabad');
    assert.equal(result.leadProfile.budget, '3 lakhs');
    assert.equal(result.leadProfile.course_interest, 'CSE');

    const persisted = transitions.find((t) => t.leadProfile);
    assert.ok(persisted);
    assert.equal(persisted.leadProfile.budget, '3 lakhs');

    const main = replyCall(llmCalls);
    const block = knownProfileMessage(main);
    assert.ok(block);
    assert.match(block.content, /12th - MPC/);
    assert.match(block.content, /Hyderabad/);
    assert.match(block.content, /3 lakhs/);
    assert.match(block.content, /CSE/);
  });

  test('active incomplete predictor injects PREDICTOR_CHECKLIST and does not call API', async () => {
    predictorIntent = 'college';
    predictorSlotPatch = { slots: { exam: 'TS_EAMCET' } };

    const result = await svc().processInbound({
      conversation,
      inbound: inbound('can I get CSE with my rank?'),
    });

    assert.equal(result.llmUsed, true);
    assert.equal(result.predictorActive, true);
    assert.equal(collegeRunCount, 0);
    assert.equal(rankRunCount, 0);
    const main = replyCall(llmCalls);
    assert.ok(checklistMessage(main));
    assert.match(checklistMessage(main).content, /PREDICTOR_CHECKLIST/);
    assert.ok(transitions.some((t) => t.predictor && t.predictor.active));
  });

  test('ready college predictor sends grounded API reply without main LLM inventing colleges', async () => {
    botContext.predictor = {
      active: true,
      type: 'college',
      slots: { __ready: true, exam: 'TS_EAMCET', rank: 45000 },
    };

    const result = await svc().processInbound({
      conversation,
      inbound: inbound('OC male'),
    });

    assert.equal(result.predictorUsed, true);
    assert.equal(result.llmUsed, false);
    assert.equal(collegeRunCount, 1);
    assert.deepEqual(sentTexts, ['COLLEGE PREDICTION RESULT']);
    assert.equal(replyCall(llmCalls), undefined);
    assert.ok(transitions.some((t) => t.predictor && t.predictor.active === false));
  });

  test('ready rank predictor sends grounded rank reply', async () => {
    botContext.predictor = {
      active: true,
      type: 'rank',
      slots: { __ready: true, examId: 'tseamcet', score: 120 },
    };

    const result = await svc().processInbound({
      conversation,
      inbound: inbound('120'),
    });

    assert.equal(result.predictorUsed, true);
    assert.equal(rankRunCount, 1);
    assert.equal(collegeRunCount, 0);
    assert.deepEqual(sentTexts, ['RANK PREDICTION RESULT']);
  });

  test('extraction failure does not block the reply; stored profile is still injected', async () => {
    botContext.leadProfile = { qualification: '12th - MPC' };
    const memory = require(memoryPath);
    mock.method(memory, 'extractProfilePatch', async () => {
      throw new Error('extract boom');
    });

    const result = await svc().processInbound({ conversation, inbound: inbound('hello') });

    assert.equal(result.llmUsed, true);
    assert.equal(result.leadProfile.qualification, '12th - MPC');
    assert.deepEqual(sentTexts, ['LLM REPLY']);
    const main = replyCall(llmCalls);
    assert.match(knownProfileMessage(main).content, /12th - MPC/);
  });

  test('STOP opts the user out and sends confirmation without calling the LLM', async () => {
    const service = svc();
    const result = await service.processInbound({ conversation, inbound: inbound('STOP') });

    assert.equal(result.optOut, true);
    assert.equal(llmCalls.length, 0);
    assert.deepEqual(transitions, [{ optedOut: true }]);
    assert.deepEqual(sentTexts, [service.OPT_OUT_REPLY]);
    assert.equal(collegeRunCount, 0);
  });

  test('opted-out user gets no reply until START (no extraction / no LLM)', async () => {
    botContext.optedOut = true;
    const result = await svc().processInbound({ conversation, inbound: inbound('hi again') });

    assert.equal(result.suppressed, true);
    assert.equal(llmCalls.length, 0);
    assert.equal(sentTexts.length, 0);
    assert.equal(transitions.length, 0);
  });

  test('START resumes an opted-out user and replies via LLM', async () => {
    botContext.optedOut = true;
    const result = await svc().processInbound({ conversation, inbound: inbound('START') });

    assert.equal(result.llmUsed, true);
    assert.ok(transitions.some((t) => t.optedOut === false));
    assert.ok(transitions.some((t) => t.leadProfile));
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

  test('history queries filter createdAt to the default cutover epoch', async () => {
    const service = svc();
    const expectedEpoch = new Date(service.DEFAULT_HISTORY_SINCE);

    await service.processInbound({ conversation, inbound: inbound('hello') });

    assert.equal(inboundFindQueries.length, 1);
    assert.equal(outboundFindQueries.length, 1);
    assert.equal(
      inboundFindQueries[0].createdAt.$gte.getTime(),
      expectedEpoch.getTime()
    );
    assert.equal(
      outboundFindQueries[0].createdAt.$gte.getTime(),
      expectedEpoch.getTime()
    );
  });

  test('CHATBOT_HISTORY_SINCE overrides the history epoch', async () => {
    process.env.CHATBOT_HISTORY_SINCE = '2026-08-01T18:00:00.000Z';
    const service = svc();
    const expectedEpoch = new Date('2026-08-01T18:00:00.000Z');

    assert.equal(service.historyEpoch().getTime(), expectedEpoch.getTime());

    await service.processInbound({ conversation, inbound: inbound('hello') });

    assert.equal(
      inboundFindQueries[0].createdAt.$gte.getTime(),
      expectedEpoch.getTime()
    );
  });
});

describe('leadProfileMemoryService helpers', () => {
  const memory = require('../services/chatbot/leadProfileMemoryService');

  test('mergeProfile ignores empty patch values and keeps prior facts', () => {
    const merged = memory.mergeProfile(
      { qualification: '12th - MPC', budget: '3L' },
      { budget: '', city_pref: 'Hyderabad', rank: null }
    );
    assert.deepEqual(merged, {
      qualification: '12th - MPC',
      budget: '3L',
      city_pref: 'Hyderabad',
    });
  });

  test('parseJsonObject strips fences and returns sanitized object', () => {
    const parsed = memory.parseJsonObject(
      '```json\n{"qualification":"12th - MPC","budget":"","topics":["Coding"]}\n```'
    );
    assert.deepEqual(parsed, {
      qualification: '12th - MPC',
      topics: ['Coding'],
    });
  });

  test('buildKnownProfileBlock wraps JSON for the system prompt contract', () => {
    const block = memory.buildKnownProfileBlock({ qualification: '12th - MPC' });
    assert.match(block, /^KNOWN_PROFILE/);
    assert.match(block, /"qualification": "12th - MPC"/);
  });

  test('extractProfilePatch returns {} when OpenAI throws', async () => {
    const llmClient = require('../services/ai/llmClient');
    mock.method(llmClient, 'chatCompletion', async () => {
      throw new Error('down');
    });
    const patch = await memory.extractProfilePatch({
      knownProfile: {},
      lastBotMessage: 'What class are you in?',
      userText: '12th mpc',
    });
    assert.deepEqual(patch, {});
    mock.restoreAll();
  });
});
