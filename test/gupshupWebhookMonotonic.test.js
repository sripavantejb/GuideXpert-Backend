const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  canApplyWebhookStatus,
  rankSuccessStatus,
  isReconcilePendingStatus
} = require('../utils/gupshupWebhookMonotonic');

describe('gupshupWebhookMonotonic reconcile-aware', () => {
  test('awaiting_final_dlr is reconcile pending below sent rank', () => {
    assert.equal(rankSuccessStatus('awaiting_final_dlr'), 3);
    assert.equal(rankSuccessStatus('sent'), 4);
    assert.equal(isReconcilePendingStatus('awaiting_final_dlr'), true);
  });

  test('awaiting_final_dlr → sent allowed', () => {
    assert.equal(canApplyWebhookStatus('awaiting_final_dlr', 'sent'), true);
  });

  test('A: awaiting_final_dlr → delivered allowed', () => {
    assert.equal(
      canApplyWebhookStatus('awaiting_final_dlr', 'delivered'),
      true
    );
    assert.equal(canApplyWebhookStatus('awaiting_final_dlr', 'read'), true);
  });

  test('reconcile-derived failed → delivered allowed (safety net)', () => {
    assert.equal(
      canApplyWebhookStatus('failed', 'delivered', { reconcileDerivedFailure: true }),
      true
    );
  });

  test('send-time failed → delivered allowed when not permanent', () => {
    assert.equal(
      canApplyWebhookStatus('failed', 'delivered', {
        reconcileDerivedFailure: false,
        terminalFailureKind: null,
        retryExclusionReason: null
      }),
      true
    );
  });

  test('G: permanent failed → delivered blocked', () => {
    assert.equal(
      canApplyWebhookStatus('failed', 'delivered', {
        reconcileDerivedFailure: false,
        terminalFailureKind: 'permanent',
        retryExclusionReason: 'permanent_failure'
      }),
      false
    );
    assert.equal(
      canApplyWebhookStatus('failed', 'delivered', {
        reconcileDerivedFailure: true,
        terminalFailureKind: 'permanent',
        retryExclusionReason: 'permanent_failure'
      }),
      false
    );
  });

  test('delivered does not regress', () => {
    assert.equal(canApplyWebhookStatus('delivered', 'submitted'), false);
  });

  test('failed webhook allowed from awaiting_final_dlr', () => {
    assert.equal(canApplyWebhookStatus('awaiting_final_dlr', 'failed'), true);
  });

  test('retry_exhausted → delivered allowed for repair recovery', () => {
    assert.equal(
      canApplyWebhookStatus('retry_exhausted', 'delivered', { allowTerminalRecovery: true }),
      true
    );
    assert.equal(canApplyWebhookStatus('retry_exhausted', 'delivered'), false);
  });
});
