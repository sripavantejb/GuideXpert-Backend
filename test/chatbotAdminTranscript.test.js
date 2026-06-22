'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/chatbotAdminService');
const inboundPath = require.resolve('../models/WhatsAppInboundMessage');
const outboundPath = require.resolve('../models/WhatsAppOutboundMessage');
const conversationPath = require.resolve('../models/WhatsAppConversation');

const CONVERSATION_ID = new mongoose.Types.ObjectId();

function makeInbound(at, text, id = new mongoose.Types.ObjectId()) {
  return {
    _id: id,
    receivedAt: new Date(at),
    messageType: 'text',
    text,
  };
}

function makeOutbound(at, text, senderType = 'bot', id = new mongoose.Types.ObjectId()) {
  return {
    _id: id,
    createdAt: new Date(at),
    messageType: 'text',
    textPreview: text,
    senderType,
    status: 'sent',
  };
}

describe('chatbotAdmin transcript pagination', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
  });

  test('initial page returns newest messages in chronological order', async () => {
    const inbound = [];
    for (let i = 1; i <= 60; i += 1) {
      inbound.push(makeInbound(`2026-06-01T10:${String(i % 60).padStart(2, '0')}:00.000Z`, `in-${i}`));
    }
    const outbound = [
      makeOutbound('2026-06-01T11:00:00.000Z', 'bot reply', 'bot'),
      makeOutbound('2026-06-01T11:01:00.000Z', 'agent reply', 'agent'),
    ];

    const WhatsAppInboundMessage = require(inboundPath);
    const WhatsAppOutboundMessage = require(outboundPath);
    const WhatsAppConversation = require(conversationPath);

    mock.method(WhatsAppInboundMessage, 'find', () => ({
      sort() {
        return {
          limit(n) {
            return {
              lean: async () => inbound.slice(-n).reverse(),
            };
          },
        };
      },
    }));
    mock.method(WhatsAppOutboundMessage, 'find', () => ({
      sort() {
        return {
          limit(n) {
            return {
              lean: async () => outbound.slice(-n).reverse(),
            };
          },
        };
      },
    }));
    mock.method(WhatsAppConversation, 'findById', () => ({
      lean: async () => ({ _id: CONVERSATION_ID, phone: '9876543210' }),
    }));

    const { getConversationTranscriptPage } = require(servicePath);
    const page = await getConversationTranscriptPage(CONVERSATION_ID, { limit: 50 });

    assert.equal(page.messages.length, 50);
    assert.equal(page.hasMoreOlder, true);
    assert.ok(new Date(page.messages[0].at) <= new Date(page.messages[1].at));
    assert.equal(page.messages.at(-1).text, 'agent reply');
    assert.ok(page.oldestCursor);
    assert.ok(page.newestCursor);
  });

  test('before cursor returns older page without overlapping newest', async () => {
    const older = [
      makeInbound('2026-06-01T09:00:00.000Z', 'old-1'),
      makeInbound('2026-06-01T09:01:00.000Z', 'old-2'),
    ];

    const WhatsAppInboundMessage = require(inboundPath);
    const WhatsAppOutboundMessage = require(outboundPath);
    const WhatsAppConversation = require(conversationPath);

    mock.method(WhatsAppInboundMessage, 'find', () => ({
      sort() {
        return {
          limit() {
            return { lean: async () => older };
          },
        };
      },
    }));
    mock.method(WhatsAppOutboundMessage, 'find', () => ({
      sort() {
        return {
          limit() {
            return { lean: async () => [] };
          },
        };
      },
    }));
    mock.method(WhatsAppConversation, 'findById', () => ({
      lean: async () => ({ _id: CONVERSATION_ID }),
    }));

    const { getConversationTranscriptPage } = require(servicePath);
    const page = await getConversationTranscriptPage(CONVERSATION_ID, {
      limit: 50,
      before: '2026-06-01T10:00:00.000Z',
      beforeId: String(new mongoose.Types.ObjectId()),
    });

    assert.equal(page.messages.length, 2);
    assert.equal(page.messages[0].text, 'old-1');
    assert.equal(page.messages[1].text, 'old-2');
  });

  test('after cursor returns only newer messages', async () => {
    const newer = [makeOutbound('2026-06-01T12:00:00.000Z', 'new reply', 'bot')];

    const WhatsAppInboundMessage = require(inboundPath);
    const WhatsAppOutboundMessage = require(outboundPath);
    const WhatsAppConversation = require(conversationPath);

    mock.method(WhatsAppInboundMessage, 'find', () => ({
      sort() {
        return {
          limit() {
            return { lean: async () => [] };
          },
        };
      },
    }));
    mock.method(WhatsAppOutboundMessage, 'find', () => ({
      sort() {
        return {
          limit() {
            return { lean: async () => newer };
          },
        };
      },
    }));
    mock.method(WhatsAppConversation, 'findById', () => ({
      lean: async () => ({ _id: CONVERSATION_ID }),
    }));

    const { getConversationTranscriptPage } = require(servicePath);
    const page = await getConversationTranscriptPage(CONVERSATION_ID, {
      limit: 50,
      after: '2026-06-01T11:00:00.000Z',
      afterId: String(new mongoose.Types.ObjectId()),
    });

    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0].text, 'new reply');
  });
});
