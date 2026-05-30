'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { getWhatsAppConfigStatus } = require('../utils/whatsappConfigStatus');

const ENV_KEYS = [
  'ENABLE_WHATSAPP',
  'GUPSHUP_API_KEY',
  'GUPSHUP_SOURCE',
  'GUPSHUP_WEBHOOK_SECRET',
  'CHATBOT_ENABLED',
  'NODE_ENV',
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

describe('whatsappConfigStatus', () => {
  let envSnap;

  beforeEach(() => {
    envSnap = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  test('ready when whatsapp, gupshup, and webhook secret configured', () => {
    process.env.ENABLE_WHATSAPP = 'true';
    process.env.GUPSHUP_API_KEY = 'key';
    process.env.GUPSHUP_SOURCE = '9199999999999';
    process.env.GUPSHUP_WEBHOOK_SECRET = 'secret';
    const s = getWhatsAppConfigStatus();
    assert.equal(s.ready, true);
    assert.equal(s.issues.length, 0);
  });

  test('ready in production without webhook secret when gupshup configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_WHATSAPP = 'true';
    process.env.GUPSHUP_API_KEY = 'key';
    process.env.GUPSHUP_SOURCE = '9199999999999';
    const s = getWhatsAppConfigStatus();
    assert.equal(s.ready, true);
    assert.ok(s.warnings.some((w) => w.includes('GUPSHUP_WEBHOOK_SECRET')));
  });

  test('not ready when AUTH_REQUIRED=1 without secret', () => {
    process.env.ENABLE_WHATSAPP = 'true';
    process.env.GUPSHUP_API_KEY = 'key';
    process.env.GUPSHUP_SOURCE = '9199999999999';
    process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED = '1';
    const s = getWhatsAppConfigStatus();
    assert.equal(s.ready, false);
    assert.ok(s.issues.some((i) => i.includes('GUPSHUP_WEBHOOK_AUTH_REQUIRED=1')));
  });
});
