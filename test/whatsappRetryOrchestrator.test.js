const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { rowEligibleAtMs } = require('../services/whatsappRetryOrchestrator');
const {
  RECONCILE_PENDING_STATUSES,
  TERMINAL_FAILURE_STATUSES
} = require('../utils/whatsappRetryRules');

describe('rowEligibleAtMs promotion gating', () => {
  test('C: awaiting_final_dlr is never promotion-eligible', () => {
    const ms = rowEligibleAtMs('pre4hr', 1, {
      status: 'awaiting_final_dlr',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      failedAt: null,
      updatedAt: new Date()
    });
    assert.equal(ms, Number.POSITIVE_INFINITY);
  });

  test('B: terminal failed after grace uses failedAt + delay', () => {
    const failedAt = new Date(Date.now() - 10 * 60 * 1000);
    const ms = rowEligibleAtMs('pre4hr', 1, {
      status: 'failed',
      failedAt,
      updatedAt: failedAt,
      createdAt: failedAt
    });
    assert.ok(Number.isFinite(ms));
    assert.ok(ms <= Date.now());
  });

  test('RECONCILE_PENDING is not terminal failure', () => {
    for (const st of RECONCILE_PENDING_STATUSES) {
      assert.equal(TERMINAL_FAILURE_STATUSES.includes(st), false);
    }
  });
});
