'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyCampaignFailure,
  isRetryableFailure,
  isMetaPermanentProviderError,
} = require('../utils/whatsappRetryRules');

const ECOSYSTEM_MSG =
  'This message was not delivered to maintain healthy ecosystem engagement.';

describe('whatsappRetryRules — Meta engagement permanent failures', () => {
  test('isMetaPermanentProviderError detects 131049 code and message', () => {
    assert.equal(isMetaPermanentProviderError({ errorCode: '131049' }), true);
    assert.equal(isMetaPermanentProviderError({ errorText: ECOSYSTEM_MSG }), true);
    assert.equal(isMetaPermanentProviderError({ errorCode: '500' }), false);
  });

  test('guidance_pre30min 131049 is not retryable', () => {
    assert.equal(
      isRetryableFailure('guidance_pre30min', {
        errorCode: '131049',
        errorText: ECOSYSTEM_MSG,
      }),
      false
    );
  });

  test('guidance_booking_submit 131049 is not retryable', () => {
    assert.equal(
      isRetryableFailure('guidance_booking_submit', {
        errorCode: '131049',
        errorText: ECOSYSTEM_MSG,
      }),
      false
    );
  });

  test('guidance_counsellor_booking_notify 131049 is not retryable', () => {
    assert.equal(
      isRetryableFailure('guidance_counsellor_booking_notify', {
        errorCode: '131049',
        errorText: ECOSYSTEM_MSG,
      }),
      false
    );
  });

  test('classifyCampaignFailure marks 131049 permanent after provider accept', () => {
    const r = classifyCampaignFailure(
      'guidance_pre30min',
      { errorCode: '131049', errorReason: ECOSYSTEM_MSG },
      { afterProviderAccept: true, attemptNumber: 1 }
    );
    assert.equal(r.retryable, false);
    assert.equal(r.terminalFailureKind, 'permanent');
  });

  test('131048 spam rate limit is permanent', () => {
    const r = classifyCampaignFailure(
      'guidance_pre30min',
      { errorCode: '131048', errorReason: 'spam rate limit' },
      { afterProviderAccept: true, attemptNumber: 1 }
    );
    assert.equal(r.retryable, false);
    assert.equal(r.terminalFailureKind, 'permanent');
  });
});
