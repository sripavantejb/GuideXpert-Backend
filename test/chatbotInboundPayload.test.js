'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseInboundWebhook,
  tryParseGupshupUserMessage,
} = require('../utils/gupshupInboundPayload');

describe('gupshupInboundPayload', () => {
  test('parses Gupshup user text message', () => {
    const body = {
      type: 'message',
      timestamp: '1710000000000',
      payload: {
        type: 'text',
        source: '919876543210',
        id: 'wamid.TEST123',
        payload: {
          type: 'text',
          text: 'Hello menu',
        },
      },
    };
    const r = tryParseGupshupUserMessage(body);
    assert.equal(r.phone10, '9876543210');
    assert.equal(r.messageType, 'text');
    assert.equal(r.text, 'Hello menu');
    assert.equal(r.providerMessageId, 'wamid.TEST123');
  });

  test('parseInboundWebhook returns isInbound', () => {
    const body = {
      type: 'message',
      payload: {
        source: '919876543210',
        id: 'wamid.ABC',
        payload: { type: 'text', text: 'When is my session?' },
      },
    };
    const { isInbound, parsed } = parseInboundWebhook(body);
    assert.equal(isInbound, true);
    assert.ok(parsed);
    assert.equal(parsed.phone10, '9876543210');
  });

  test('message-event is not inbound', () => {
    const body = {
      type: 'message-event',
      payload: { type: 'delivered', destination: '919876543210' },
    };
    const { isInbound } = parseInboundWebhook(body);
    assert.equal(isInbound, false);
  });
});
