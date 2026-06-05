'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInboundDedupeKey,
  parseInboundWebhook,
} = require('../utils/gupshupInboundPayload');

describe('buildInboundDedupeKey', () => {
  test('uses the same key for Gupshup and Meta payloads with identical text', () => {
    const receivedAt = new Date('2026-06-05T09:02:00.000Z');
    const gupshupBody = {
      type: 'message',
      payload: {
        source: '919876543210',
        id: 'gupshup-msg-111',
        payload: { type: 'text', text: 'iam not getting' },
      },
    };
    const metaBody = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.META999',
                    type: 'text',
                    text: { body: 'iam not getting' },
                    timestamp: String(Math.floor(receivedAt.getTime() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const gup = parseInboundWebhook(gupshupBody).parsed;
    const meta = parseInboundWebhook(metaBody).parsed;
    gup.receivedAt = receivedAt;
    meta.receivedAt = receivedAt;

    const gupKey = buildInboundDedupeKey(gup, gupshupBody);
    const metaKey = buildInboundDedupeKey(meta, metaBody);

    assert.equal(gupKey, metaKey);
    assert.match(gupKey, /^in:content:/);
    assert.notEqual(gup.providerMessageId, meta.providerMessageId);
  });

  test('uses different keys for different text from the same phone', () => {
    const receivedAt = new Date('2026-06-05T09:02:00.000Z');
    const first = buildInboundDedupeKey(
      {
        phone10: '9876543210',
        text: 'hello',
        receivedAt,
      },
      {}
    );
    const second = buildInboundDedupeKey(
      {
        phone10: '9876543210',
        text: 'what is niat',
        receivedAt,
      },
      {}
    );

    assert.notEqual(first, second);
  });

  test('falls back to provider id for non-text inbound', () => {
    const key = buildInboundDedupeKey(
      {
        phone10: '9876543210',
        text: null,
        dedupeKey: 'provider-uuid-1',
        receivedAt: new Date(),
      },
      {}
    );

    assert.equal(key, 'in:provider:provider-uuid-1');
  });
});
