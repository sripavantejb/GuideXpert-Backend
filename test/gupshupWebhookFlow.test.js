const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseGupshupTemplateSendResponse,
  messageEventIdMatchClause,
  isLikelyGupshupInternalId
} = require('../utils/gupshupMessageIds');
const {
  mapStageToDbStatus,
  canApplyWebhookStatus
} = require('../utils/gupshupWebhookMonotonic');

describe('gupshupMessageIds', () => {
  test('parses Gupshup UUID from template send response', () => {
    const id = '59f8db90-c37e-4408-90ab-cc54ef8246ad';
    const r = parseGupshupTemplateSendResponse({ messageId: id });
    assert.equal(r.gupshupInternalMessageId, id);
    assert.equal(r.canonicalMessageId, id);
  });

  test('messageEventIdMatchClause matches all stored id fields', () => {
    const gs = '72f61f22-5aa4-4615-a970-943edf6da01c';
    const wa = 'gBEGkYaYVSEEAgnZxQ3JmKK6Wvg';
    const q = messageEventIdMatchClause([gs, wa]);
    assert.ok(q.$or);
    assert.equal(q.$or.length, 3);
  });

  test('isLikelyGupshupInternalId accepts RFC UUID', () => {
    assert.equal(isLikelyGupshupInternalId('59f8db90-c37e-4408-90ab-cc54ef8246ad'), true);
    assert.equal(isLikelyGupshupInternalId('not-a-uuid'), false);
  });
});

describe('gupshupWebhookMonotonic', () => {
  test('mapStageToDbStatus maps enqueued to submitted', () => {
    assert.equal(mapStageToDbStatus('enqueued'), 'submitted');
    assert.equal(mapStageToDbStatus('sent'), 'sent');
  });

  test('monotonic: delivered does not regress to submitted', () => {
    assert.equal(canApplyWebhookStatus('delivered', 'submitted'), false);
  });

  test('monotonic: submitted advances to sent', () => {
    assert.equal(canApplyWebhookStatus('submitted', 'sent'), true);
  });

  test('monotonic: duplicate sent ignored', () => {
    assert.equal(canApplyWebhookStatus('sent', 'sent'), false);
  });

  test('monotonic: read not overwritten by sent', () => {
    assert.equal(canApplyWebhookStatus('read', 'sent'), false);
  });

  test('webhook failed ignored after delivered', () => {
    assert.equal(canApplyWebhookStatus('delivered', 'failed'), false);
  });

  test('webhook failed allowed after submitted', () => {
    assert.equal(canApplyWebhookStatus('submitted', 'failed'), true);
  });
});
