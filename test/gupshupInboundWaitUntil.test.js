'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('gupshup inbound webhook processing', () => {
  test('webhook controller awaits inbound handling instead of returning queued early', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../controllers/gupshupWebhookController.js'),
      'utf8'
    );
    assert.match(source, /await handleInboundWebhook\(req, body, receivedAt\)/);
    assert.doesNotMatch(source, /\bqueued:\s*true\b/);
    assert.doesNotMatch(source, /\bwaitUntil\b/);
  });
});
