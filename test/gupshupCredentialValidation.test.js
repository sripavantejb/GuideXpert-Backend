'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const validationPath = require.resolve('../utils/gupshupCredentialValidation');

describe('gupshupCredentialValidation', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    delete require.cache[validationPath];
  });

  function load() {
    delete require.cache[validationPath];
    return require(validationPath);
  }

  test('rejects stub mode and placeholder credentials', () => {
    process.env.WA_INTEGRATION_STUB = '1';
    process.env.GUPSHUP_API_KEY = 'local-dev-placeholder';
    process.env.GUPSHUP_SOURCE = '9199999999999';
    const v = load();
    assert.equal(v.isGupshupOutboundConfigured(), false);
    const issues = v.getGupshupCredentialIssues();
    assert.ok(issues.some((i) => i.includes('WA_INTEGRATION_STUB')));
    assert.ok(issues.some((i) => i.includes('placeholder')));
  });

  test('accepts real-looking credentials with stub off', () => {
    process.env.WA_INTEGRATION_STUB = '0';
    process.env.GUPSHUP_API_KEY = 'sk_live_abc123def456';
    process.env.GUPSHUP_SOURCE = '919876543210';
    const v = load();
    assert.equal(v.isGupshupOutboundConfigured(), true);
    assert.deepEqual(v.getGupshupCredentialIssues(), []);
  });
});
