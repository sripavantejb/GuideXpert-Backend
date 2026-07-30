'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');

/**
 * G-2b partIndex + bot_reply_inbound_part_unique live on
 * fix/g2b-multipart-delivery (PR 4, held). These assertions belong with that
 * branch; skip on feat/flow-v3-foundation until the model lands.
 */
const G2B_PART_INDEX_READY = Boolean(WhatsAppOutboundMessage.schema.path('partIndex'));

const outboundServicePath = require.resolve('../../services/chatbot/whatsappOutboundService');
const gupshupSessionPath = require.resolve('../../services/chatbot/gupshupSessionService');
const sessionFallbackPath = require.resolve('../../services/chatbot/sessionFallbackService');
const processorsPath = require.resolve('../../services/chatbot/guidedFlows/guidedFlowProcessors');
const orchestratorPath = require.resolve('../../services/chatbot/guidedFlows/guidedFlowOrchestrator');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

function idsEqual(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function matchesQuery(doc, query) {
  if (!query || typeof query !== 'object') return true;
  for (const [key, expected] of Object.entries(query)) {
    if (key === '$or' || key === '$and') continue;
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof mongoose.Types.ObjectId)) {
      if (expected.$in) {
        if (!expected.$in.includes(actual)) return false;
        continue;
      }
      if (expected.$type) {
        if (expected.$type === 'objectId' && !(actual instanceof mongoose.Types.ObjectId) && !mongoose.isValidObjectId(actual)) {
          return false;
        }
        if (expected.$type === 'number' && typeof actual !== 'number') return false;
        continue;
      }
    }
    if (expected instanceof mongoose.Types.ObjectId || mongoose.isValidObjectId(expected)) {
      if (!idsEqual(actual, expected)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function createOutboundStore() {
  const rows = [];
  let writeChain = Promise.resolve();

  function withWriteLock(fn) {
    const run = writeChain.then(fn);
    writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function botTupleOccupied(inboundId, partIndex) {
    return rows.some(
      (r) =>
        r.senderType === 'bot' &&
        idsEqual(r.inReplyToInboundId, inboundId) &&
        r.partIndex === partIndex
    );
  }

  const api = {
    rows,
    findOne(query) {
      return {
        lean: async () => {
          const hit = rows.find((r) => matchesQuery(r, query));
          return hit ? { ...hit } : null;
        },
        select() {
          return this;
        },
      };
    },
    create(doc) {
      return withWriteLock(async () => {
        const partIndex = Number.isInteger(doc.partIndex) ? doc.partIndex : 0;
        if (
          doc.senderType === 'bot' &&
          doc.inReplyToInboundId &&
          botTupleOccupied(doc.inReplyToInboundId, partIndex)
        ) {
          const err = new Error('E11000 duplicate key error');
          err.code = 11000;
          throw err;
        }
        const row = {
          _id: new mongoose.Types.ObjectId(),
          ...doc,
          partIndex,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      });
    },
    findOneAndUpdate(query, update, options = {}) {
      return withWriteLock(async () => {
        const idx = rows.findIndex((r) => matchesQuery(r, query));
        if (idx < 0) return null;
        const set = (update && update.$set) || update || {};
        rows[idx] = { ...rows[idx], ...set, updatedAt: new Date() };
        return options.new === false ? null : { ...rows[idx] };
      });
    },
    updateOne(query, update) {
      return withWriteLock(async () => {
        const idx = rows.findIndex((r) => matchesQuery(r, query));
        if (idx < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        const set = (update && update.$set) || update || {};
        rows[idx] = { ...rows[idx], ...set, updatedAt: new Date() };
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      });
    },
    seedFailed(partIndex = 0) {
      const row = {
        _id: new mongoose.Types.ObjectId(),
        conversationId: CONVERSATION_ID,
        phone: PHONE,
        senderType: 'bot',
        messageType: 'text',
        content: { type: 'text', text: 'old' },
        textPreview: 'old',
        status: 'failed',
        inReplyToInboundId: INBOUND_ID,
        partIndex,
      };
      rows.push(row);
      return row;
    },
  };
  return api;
}

function installOutboundMocks(store, provider) {
  const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
  mock.method(WhatsAppOutboundMessage, 'findOne', (query) => store.findOne(query));
  mock.method(WhatsAppOutboundMessage, 'create', (doc) => store.create(doc));
  mock.method(WhatsAppOutboundMessage, 'findOneAndUpdate', (q, u, o) => store.findOneAndUpdate(q, u, o));
  mock.method(WhatsAppOutboundMessage, 'updateOne', (q, u) => store.updateOne(q, u));

  const gupshupSession = require(gupshupSessionPath);
  mock.method(gupshupSession, 'sendTextMessage', (...args) => provider.sendTextMessage(...args));
  mock.method(gupshupSession, 'sendButtonMessage', (...args) => provider.sendButtonMessage(...args));
  mock.method(gupshupSession, 'sendListMessage', (...args) => provider.sendListMessage(...args));
  mock.method(gupshupSession, 'sendImageMessage', (...args) => provider.sendImageMessage(...args));
}

const G2B_SKIP = G2B_PART_INDEX_READY
  ? false
  : 'G-2b partIndex model is on fix/g2b-multipart-delivery (PR 4)';

function g2bTest(name, fn) {
  return test(name, { skip: G2B_SKIP }, fn);
}

describe('multipart outbound G-2b', () => {
  let store;
  let providerCalls;

  beforeEach(() => {
    store = createOutboundStore();
    providerCalls = { text: 0, button: 0, list: 0, image: 0 };

    delete require.cache[outboundServicePath];
    delete require.cache[gupshupSessionPath];
    delete require.cache[sessionFallbackPath];

    const provider = {
      sendTextMessage: async () => {
        providerCalls.text += 1;
        return { success: true, data: { messageId: `text-${providerCalls.text}` } };
      },
      sendButtonMessage: async () => {
        providerCalls.button += 1;
        return { success: true, data: { messageId: `btn-${providerCalls.button}` } };
      },
      sendListMessage: async () => {
        providerCalls.list += 1;
        return { success: true, data: { messageId: `list-${providerCalls.list}` } };
      },
      sendImageMessage: async () => {
        providerCalls.image += 1;
        return { success: true, data: { messageId: `img-${providerCalls.image}` } };
      },
    };
    installOutboundMocks(store, provider);
  });

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[outboundServicePath];
    delete require.cache[gupshupSessionPath];
    delete require.cache[sessionFallbackPath];
    delete require.cache[orchestratorPath];
    delete require.cache[processorsPath];
  });

  g2bTest('schema defines compound unique partial index', () => {
    const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
    const indexes = WhatsAppOutboundMessage.schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.inReplyToInboundId === 1 && fields.partIndex === 1
    );
    assert.ok(compound);
    assert.equal(compound[1].unique, true);
    assert.equal(compound[1].name, 'bot_reply_inbound_part_unique');
  });

  g2bTest('three distinct parts call provider exactly three times and create rows', async () => {
    const outbound = require(outboundServicePath);
    const base = {
      conversationId: CONVERSATION_ID,
      phone10: PHONE,
      inReplyToInboundId: INBOUND_ID,
    };

    const r0 = await outbound.sendBotTextReply({ ...base, text: 'part-0', partIndex: 0 });
    const r1 = await outbound.sendBotImageReply({
      ...base,
      url: 'https://example.com/a.png',
      partIndex: 1,
    });
    const r2 = await outbound.sendBotButtonReply({
      ...base,
      body: 'Choose',
      buttons: [{ id: 'a', title: 'A' }],
      partIndex: 2,
    });

    assert.equal(r0.success, true);
    assert.equal(r1.success, true);
    assert.equal(r2.success, true);
    assert.equal(r0.newlySent, true);
    assert.equal(providerCalls.text, 1);
    assert.equal(providerCalls.image, 1);
    assert.equal(providerCalls.button, 1);
    assert.equal(store.rows.length, 3);
    assert.deepEqual(
      store.rows.map((r) => r.partIndex).sort((a, b) => a - b),
      [0, 1, 2]
    );
  });

  g2bTest('exact retry of same tuples adds zero provider sends', async () => {
    const outbound = require(outboundServicePath);
    const base = {
      conversationId: CONVERSATION_ID,
      phone10: PHONE,
      inReplyToInboundId: INBOUND_ID,
    };

    await outbound.sendBotTextReply({ ...base, text: 'a', partIndex: 0 });
    await outbound.sendBotTextReply({ ...base, text: 'b', partIndex: 1 });
    await outbound.sendBotTextReply({ ...base, text: 'c', partIndex: 2 });
    assert.equal(providerCalls.text, 3);

    const retry0 = await outbound.sendBotTextReply({ ...base, text: 'a', partIndex: 0 });
    const retry1 = await outbound.sendBotTextReply({ ...base, text: 'b', partIndex: 1 });
    const retry2 = await outbound.sendBotTextReply({ ...base, text: 'c', partIndex: 2 });

    assert.equal(retry0.duplicatePrevented, true);
    assert.equal(retry1.duplicatePrevented, true);
    assert.equal(retry2.duplicatePrevented, true);
    assert.equal(providerCalls.text, 3);
    assert.equal(store.rows.length, 3);
  });

  g2bTest('concurrent same tuple only one provider send', async () => {
    const outbound = require(outboundServicePath);
    const args = {
      conversationId: CONVERSATION_ID,
      phone10: PHONE,
      text: 'race',
      inReplyToInboundId: INBOUND_ID,
      partIndex: 0,
    };

    const [a, b] = await Promise.all([
      outbound.sendBotTextReply(args),
      outbound.sendBotTextReply(args),
    ]);

    const prevented = [a, b].filter((r) => r.duplicatePrevented);
    const sent = [a, b].filter((r) => r.newlySent && !r.duplicatePrevented);
    assert.equal(providerCalls.text, 1);
    assert.equal(sent.length, 1);
    assert.equal(prevented.length, 1);
    assert.equal(store.rows.length, 1);
  });

  g2bTest('failed tuple is atomically reclaimed once', async () => {
    store.seedFailed(0);
    const outbound = require(outboundServicePath);
    const args = {
      conversationId: CONVERSATION_ID,
      phone10: PHONE,
      text: 'retry-failed',
      inReplyToInboundId: INBOUND_ID,
      partIndex: 0,
    };

    const [a, b] = await Promise.all([
      outbound.sendBotTextReply(args),
      outbound.sendBotTextReply(args),
    ]);

    const newly = [a, b].filter((r) => r.newlySent && !r.duplicatePrevented);
    const dupes = [a, b].filter((r) => r.duplicatePrevented);
    assert.equal(newly.length, 1);
    assert.equal(dupes.length, 1);
    assert.equal(providerCalls.text, 1);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].status, 'submitted');
  });
});

describe('guidedFlowOrchestrator multipart partIndex', () => {
  let outboundCalls;

  beforeEach(() => {
    outboundCalls = [];
    delete require.cache[orchestratorPath];
    delete require.cache[processorsPath];

    const processors = require('../../services/chatbot/guidedFlows/guidedFlowProcessors');
    mock.method(processors, 'processGuidedFlowTurn', async () => ({
      replyText: null,
      replyParts: ['bubble-one', 'bubble-two'],
      replyMedia: { type: 'image', url: 'https://example.com/m.png', caption: null },
      interactive: null,
      nextState: 'career_counselling_flow_v2',
      contextPatch: {},
      intent: 'career_counselling_flow_v2',
      localizationTier: 'static',
      preLocalized: true,
    }));
  });

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[orchestratorPath];
    delete require.cache[processorsPath];
  });

  g2bTest('orchestrator assigns stable indexes and reports envelope/sent counts', async () => {
    const { executeActiveGuidedFlowTurn } = require(orchestratorPath);

    const result = await executeActiveGuidedFlowTurn({
      flow: { id: 'career_counselling_flow_v2', botState: 'career_counselling_flow_v2' },
      activeConversation: { _id: CONVERSATION_ID, phone: PHONE },
      inbound: { _id: INBOUND_ID, text: 'hi', messageType: 'text' },
      botState: { state: 'career_counselling_flow_v2', context: {} },
      multilingualInbound: { englishMessage: 'hi', resolvedLanguage: 'en', language: 'en' },
      startedAt: Date.now(),
      transitionState: async () => {},
      deliverOutboundReply: async ({ replyText }) => replyText,
      logInboundResult: () => {},
      resolvedLanguageFrom: () => 'en',
      h: {
        outbound: {
          sendBotTextReply: async (args) => {
            outboundCalls.push({ type: 'text', ...args });
            return {
              success: true,
              newlySent: true,
              partIndex: args.partIndex,
              outboundId: new mongoose.Types.ObjectId(),
            };
          },
          sendBotImageReply: async (args) => {
            outboundCalls.push({ type: 'image', ...args });
            return {
              success: true,
              newlySent: true,
              partIndex: args.partIndex,
              outboundId: new mongoose.Types.ObjectId(),
            };
          },
          sendBotButtonReply: async () => {
            throw new Error('should not send button');
          },
          sendBotListReply: async () => {
            throw new Error('should not send list');
          },
        },
      },
    });

    assert.equal(outboundCalls.length, 3);
    assert.deepEqual(
      outboundCalls.map((c) => [c.type, c.partIndex]),
      [
        ['text', 0],
        ['text', 1],
        ['image', 2],
      ]
    );
    assert.ok(outboundCalls.every((c) => idsEqual(c.inReplyToInboundId, INBOUND_ID)));
    assert.equal(result.envelopePartCount, 3);
    assert.equal(result.sentPartCount, 3);
    assert.equal(result.newlySent, 3);
    assert.equal(result.success, true);
  });

  g2bTest('middle failure is not hidden by a successful final part', async () => {
    const { executeActiveGuidedFlowTurn } = require(orchestratorPath);

    const result = await executeActiveGuidedFlowTurn({
      flow: { id: 'career_counselling_flow_v2', botState: 'career_counselling_flow_v2' },
      activeConversation: { _id: CONVERSATION_ID, phone: PHONE },
      inbound: { _id: INBOUND_ID, text: 'hi', messageType: 'text' },
      botState: { state: 'career_counselling_flow_v2', context: {} },
      multilingualInbound: { englishMessage: 'hi', resolvedLanguage: 'en', language: 'en' },
      startedAt: Date.now(),
      transitionState: async () => {},
      deliverOutboundReply: async ({ replyText }) => replyText,
      logInboundResult: () => {},
      resolvedLanguageFrom: () => 'en',
      h: {
        outbound: {
          sendBotTextReply: async (args) => {
            if (args.partIndex === 1) {
              return { success: false, newlySent: true, partIndex: 1, error: 'provider down' };
            }
            return { success: true, newlySent: true, partIndex: args.partIndex };
          },
          sendBotImageReply: async (args) => ({
            success: true,
            newlySent: true,
            partIndex: args.partIndex,
          }),
        },
      },
    });

    assert.equal(result.envelopePartCount, 3);
    assert.equal(result.sentPartCount, 2);
    assert.equal(result.success, false);
  });
});
