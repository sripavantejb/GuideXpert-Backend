'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const outboundServicePath = require.resolve('../../services/chatbot/whatsappOutboundService');
const gupshupSessionPath = require.resolve('../../services/chatbot/gupshupSessionService');

const G2B_PART_INDEX_READY = Boolean(
  require('../../models/WhatsAppOutboundMessage').schema.path('partIndex')
);
const G2B_SKIP = G2B_PART_INDEX_READY
  ? false
  : 'G-2b partIndex model is on fix/g2b-multipart-delivery (PR 4)';

function g2bTest(name, fn) {
  return test(name, { skip: G2B_SKIP }, fn);
}

describe('G-2b multipart idempotency (3-part envelope)', () => {
  let sendCalls;
  let createdDocs;
  let store;

  beforeEach(() => {
    sendCalls = 0;
    createdDocs = [];
    store = new Map();

    delete require.cache[outboundServicePath];
    delete require.cache[gupshupSessionPath];

    const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');

    function keyOf(inboundId, partIndex) {
      return `${String(inboundId)}:${Number(partIndex)}`;
    }

    mock.method(WhatsAppOutboundMessage, 'findOne', (query) => {
      const lean = async () => {
        if (!query.inReplyToInboundId) return null;
        const row = store.get(keyOf(query.inReplyToInboundId, query.partIndex));
        if (!row) return null;
        if (query.status?.$in && !query.status.$in.includes(row.status)) return null;
        return { ...row };
      };
      return { lean, select: () => ({ lean }) };
    });

    mock.method(WhatsAppOutboundMessage, 'create', async (doc) => {
      const k = keyOf(doc.inReplyToInboundId, doc.partIndex);
      if (doc.inReplyToInboundId && store.has(k)) {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      }
      const row = {
        _id: new mongoose.Types.ObjectId(),
        ...doc,
        partIndex: doc.partIndex ?? 0,
      };
      if (doc.inReplyToInboundId) store.set(k, row);
      createdDocs.push(row);
      return row;
    });

    mock.method(WhatsAppOutboundMessage, 'findOneAndUpdate', async () => null);
    mock.method(WhatsAppOutboundMessage, 'updateOne', async (filter, update) => {
      for (const row of store.values()) {
        if (String(row._id) === String(filter._id)) {
          Object.assign(row, update.$set || {});
        }
      }
      return { acknowledged: true };
    });

    const gupshupSession = require(gupshupSessionPath);
    mock.method(gupshupSession, 'sendTextMessage', async () => {
      sendCalls += 1;
      return { success: true, data: { messageId: `msg-${sendCalls}` } };
    });
    mock.method(gupshupSession, 'sendImageMessage', async () => {
      sendCalls += 1;
      return { success: true, data: { messageId: `msg-${sendCalls}` } };
    });
    mock.method(gupshupSession, 'sendButtonMessage', async () => {
      sendCalls += 1;
      return { success: true, data: { messageId: `msg-${sendCalls}` } };
    });
  });

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[outboundServicePath];
    delete require.cache[gupshupSessionPath];
  });

  g2bTest('3 indexed parts send once; replay sends zero additional provider messages', async () => {
    const outbound = require(outboundServicePath);
    const conversationId = new mongoose.Types.ObjectId();
    const inboundId = new mongoose.Types.ObjectId();
    const phone10 = '9876543210';

    const first = [];
    first.push(
      await outbound.sendBotTextReply({
        conversationId,
        phone10,
        text: 'Part 0',
        inReplyToInboundId: inboundId,
        partIndex: 0,
      })
    );
    first.push(
      await outbound.sendBotImageReply({
        conversationId,
        phone10,
        url: 'https://example.com/a.jpg',
        inReplyToInboundId: inboundId,
        partIndex: 1,
      })
    );
    first.push(
      await outbound.sendBotButtonReply({
        conversationId,
        phone10,
        body: 'Part 2',
        buttons: [{ id: 'a', title: 'A' }],
        inReplyToInboundId: inboundId,
        partIndex: 2,
      })
    );

    assert.equal(first.length, 3);
    assert.ok(first.every((r) => r.success));
    assert.equal(sendCalls, 3);
    assert.equal(createdDocs.length, 3);
    assert.deepEqual(
      createdDocs.map((d) => d.partIndex).sort((a, b) => a - b),
      [0, 1, 2]
    );

    const envelopePartCount = 3;
    const sentPartCount = first.filter((r) => r.success).length;
    assert.equal(sentPartCount, envelopePartCount);

    const replaySendBefore = sendCalls;
    const replay = [];
    for (let partIndex = 0; partIndex < 3; partIndex += 1) {
      replay.push(
        await outbound.sendBotTextReply({
          conversationId,
          phone10,
          text: `Replay ${partIndex}`,
          inReplyToInboundId: inboundId,
          partIndex,
        })
      );
    }
    assert.ok(replay.every((r) => r.duplicatePrevented === true));
    assert.equal(sendCalls, replaySendBefore);
  });
});
