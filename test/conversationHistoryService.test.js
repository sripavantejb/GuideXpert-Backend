'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const { getConversationHistory } = require('../services/chatbot/conversationHistoryService');

function findChain(rows) {
  let max = rows.length;
  return {
    sort() {
      return this;
    },
    limit(n) {
      max = n;
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(rows.slice(0, max));
    },
  };
}

afterEach(() => {
  mock.restoreAll();
});

describe('conversationHistoryService', () => {
  test('merges recent inbound and outbound text messages chronologically', async () => {
    mock.method(WhatsAppInboundMessage, 'find', () =>
      findChain([
        {
          messageType: 'text',
          text: 'How is it different?',
          receivedAt: new Date('2026-06-04T10:02:00.000Z'),
        },
        {
          messageType: 'text',
          text: 'What is NIAT?',
          receivedAt: new Date('2026-06-04T10:00:00.000Z'),
        },
      ])
    );
    mock.method(WhatsAppOutboundMessage, 'find', () =>
      findChain([
        {
          messageType: 'text',
          content: { text: 'NIAT is an industry-ready upskilling program.' },
          createdAt: new Date('2026-06-04T10:01:00.000Z'),
        },
      ])
    );

    const history = await getConversationHistory({ conversationId: 'convo1', limit: 10 });

    assert.deepEqual(history, [
      { role: 'user', content: 'What is NIAT?' },
      { role: 'assistant', content: 'NIAT is an industry-ready upskilling program.' },
      { role: 'user', content: 'How is it different?' },
    ]);
  });

  test('returns at most the newest 10 messages and ignores media or blank rows', async () => {
    const inboundRows = Array.from({ length: 11 }, (_, i) => ({
      messageType: 'text',
      text: `User ${11 - i}`,
      receivedAt: new Date(Date.UTC(2026, 5, 4, 10, 11 - i, 0)),
    }));
    inboundRows.unshift({
      messageType: 'image',
      text: 'ignore media caption',
      receivedAt: new Date('2026-06-04T10:30:00.000Z'),
    });
    inboundRows.unshift({
      messageType: 'text',
      text: '   ',
      receivedAt: new Date('2026-06-04T10:31:00.000Z'),
    });

    mock.method(WhatsAppInboundMessage, 'find', () =>
      findChain(inboundRows.filter((row) => row.messageType === 'text' && row.text.trim()))
    );
    mock.method(WhatsAppOutboundMessage, 'find', () => findChain([]));

    const history = await getConversationHistory({ conversationId: 'convo1', limit: 20 });

    assert.equal(history.length, 10);
    assert.equal(history[0].content, 'User 2');
    assert.equal(history[9].content, 'User 11');
    assert.ok(history.every((message) => message.role === 'user'));
  });
});
