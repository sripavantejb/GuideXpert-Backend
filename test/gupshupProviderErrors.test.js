'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractGupshupSendErrorCode,
  parseMetaCodeFromText,
  extractCodeFromPayloadSnippet,
  resolveProviderErrorDisplay
} = require('../utils/gupshupProviderErrors');

describe('gupshupProviderErrors', () => {
  test('extractGupshupSendErrorCode reads code from API body', () => {
    assert.equal(extractGupshupSendErrorCode({ code: 470 }, null), '470');
    assert.equal(extractGupshupSendErrorCode({ errorCode: '131026' }, null), '131026');
  });

  test('extractGupshupSendErrorCode falls back to HTTP status', () => {
    assert.equal(extractGupshupSendErrorCode(null, 400), 'HTTP_400');
    assert.equal(extractGupshupSendErrorCode({}, 503), 'HTTP_503');
  });

  test('parseMetaCodeFromText extracts (#132012)', () => {
    assert.equal(
      parseMetaCodeFromText('(#132012) Parameter format does not match'),
      '132012'
    );
    assert.equal(parseMetaCodeFromText('generic failure'), null);
  });

  test('extractCodeFromPayloadSnippet parses JSON snippet', () => {
    assert.equal(
      extractCodeFromPayloadSnippet(JSON.stringify({ code: 999 })),
      '999'
    );
  });

  test('resolveProviderErrorDisplay prefers DLR webhookErrorCode over sendErrorCode', () => {
    const dlr = resolveProviderErrorDisplay({
      webhookErrorCode: '132012',
      webhookErrorReason: 'Meta DLR failure',
      sendErrorCode: '470',
      errorMessage: 'send text'
    });
    assert.equal(dlr.errorCode, '132012');
    assert.equal(dlr.errorSource, 'dlr');
    assert.match(dlr.errorReason, /Meta DLR/);
  });

  test('resolveProviderErrorDisplay uses sendErrorCode when no DLR code', () => {
    const send = resolveProviderErrorDisplay({
      sendErrorCode: 'HTTP_400',
      errorMessage: 'Bad request'
    });
    assert.equal(send.errorCode, 'HTTP_400');
    assert.equal(send.errorSource, 'send');
    assert.equal(send.errorReason, 'Bad request');
  });

  test('resolveProviderErrorDisplay parses Meta code from errorMessage', () => {
    const parsed = resolveProviderErrorDisplay({
      errorMessage: '(#131026) Receiver is not valid'
    });
    assert.equal(parsed.errorCode, '131026');
    assert.equal(parsed.errorSource, 'parsed');
  });
});
