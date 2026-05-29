'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyGupshupWebhookRequest,
  isWebhookAuthEnforced,
  timingSafeEqualStrings,
  extractWebhookCredential,
} = require('../utils/gupshupWebhookAuth');

const ENV_KEYS = [
  'GUPSHUP_WEBHOOK_SECRET',
  'GUPSHUP_WEBHOOK_AUTH_REQUIRED',
];

function saveEnv() {
  const snap = {};
  for (const k of ENV_KEYS) {
    snap[k] = process.env[k];
  }
  return snap;
}

function restoreEnv(snap) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe('gupshupWebhookAuth', () => {
  let envSnap;

  beforeEach(() => {
    envSnap = saveEnv();
    delete process.env.GUPSHUP_WEBHOOK_SECRET;
    delete process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED;
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  test('timingSafeEqualStrings matches equal strings', () => {
    assert.equal(timingSafeEqualStrings('abc', 'abc'), true);
    assert.equal(timingSafeEqualStrings('abc', 'abd'), false);
    assert.equal(timingSafeEqualStrings('abc', 'ab'), false);
  });

  test('auth not enforced when secret unset and AUTH_REQUIRED off', () => {
    assert.equal(isWebhookAuthEnforced(), false);
    const r = verifyGupshupWebhookRequest({ headers: {} });
    assert.equal(r.ok, true);
  });

  test('auth enforced when secret is set', () => {
    process.env.GUPSHUP_WEBHOOK_SECRET = 'test-secret';
    assert.equal(isWebhookAuthEnforced(), true);
    const bad = verifyGupshupWebhookRequest({ headers: {} });
    assert.equal(bad.ok, false);
    assert.equal(bad.statusCode, 401);
    const good = verifyGupshupWebhookRequest({
      headers: { 'x-webhook-secret': 'test-secret' },
    });
    assert.equal(good.ok, true);
  });

  test('AUTH_REQUIRED without secret returns 503', () => {
    process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED = '1';
    const r = verifyGupshupWebhookRequest({ headers: { 'x-webhook-secret': 'x' } });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 503);
    assert.equal(r.error, 'webhook_secret_not_configured');
  });

  test('extractWebhookCredential reads header and query', () => {
    assert.equal(
      extractWebhookCredential({ headers: { 'x-webhook-secret': 'a' }, query: {} }),
      'a'
    );
    assert.equal(
      extractWebhookCredential({ headers: {}, query: { secret: 'q' } }),
      'q'
    );
  });
});
