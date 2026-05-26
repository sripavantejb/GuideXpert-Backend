'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { describeOpsFailure } = require('../utils/whatsappOpsFailureCopy');

describe('whatsappOpsFailureCopy', () => {
  test('131049 maps to engagement limit headline with provider detail', () => {
    const r = describeOpsFailure({
      webhookErrorCode: '131049',
      webhookErrorReason:
        'This message was not delivered to maintain healthy ecosystem engagement.',
      errorSource: 'dlr',
    });
    assert.match(r.headline, /engagement limit/i);
    assert.match(r.detail, /healthy ecosystem/i);
    assert.equal(r.technicalCode, '131049');
    assert.equal(r.category, 'provider');
  });

  test('transient_unresolved uses lifecycle headline not raw slug', () => {
    const r = describeOpsFailure({
      reason: 'transient_unresolved',
      lifecycleState: 'failed',
    });
    assert.equal(r.headline, 'Delivery failed (may be retried)');
    assert.doesNotMatch(r.headline, /transient_unresolved/);
    assert.equal(r.category, 'lifecycle');
  });

  test('provider reason preserved in detail when headline is mapped', () => {
    const r = describeOpsFailure({
      webhookErrorCode: '131026',
      webhookErrorReason: 'Message undeliverable — user may not be on WhatsApp.',
      errorSource: 'dlr',
    });
    assert.match(r.headline, /undeliverable/i);
    assert.match(r.detail, /undeliverable/i);
  });

  test('HTTP send code maps to Gupshup send headline', () => {
    const r = describeOpsFailure({
      sendErrorCode: 'HTTP_503',
      errorMessage: 'Service unavailable',
      errorSource: 'send',
    });
    assert.match(r.headline, /Gupshup/i);
    assert.match(r.headline, /unavailable/i);
  });
});
