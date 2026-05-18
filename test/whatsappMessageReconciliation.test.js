const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  dlrReconcileStaleMs,
  dlrReconcileGraceMs,
  RECONCILE_PENDING_STATUSES
} = require('../utils/whatsappRetryRules');
const {
  AWAITING_STATUS,
  STALE_SOURCE_STATUSES,
  reconcileBatchLimit,
  reconcileMaxPasses
} = require('../services/whatsappMessageReconciliation');

describe('reconciliation constants', () => {
  test('awaiting status is reconcile pending', () => {
    assert.equal(AWAITING_STATUS, 'awaiting_final_dlr');
    assert.deepEqual(RECONCILE_PENDING_STATUSES, ['awaiting_final_dlr']);
    assert.deepEqual(STALE_SOURCE_STATUSES, ['submitted', 'sent']);
  });

  test('grace defaults to at least 30 minutes', () => {
    const prev = process.env.WA_DLR_RECONCILE_GRACE_MS;
    delete process.env.WA_DLR_RECONCILE_GRACE_MS;
    assert.ok(dlrReconcileGraceMs() >= 30 * 60 * 1000);
    if (prev != null) process.env.WA_DLR_RECONCILE_GRACE_MS = prev;
  });

  test('stale threshold defaults to at least 45 minutes', () => {
    const prev = process.env.WA_DLR_RECONCILE_STALE_MS;
    delete process.env.WA_DLR_RECONCILE_STALE_MS;
    assert.ok(dlrReconcileStaleMs() >= 45 * 60 * 1000);
    if (prev != null) process.env.WA_DLR_RECONCILE_STALE_MS = prev;
  });

  test('total patience is stale + grace', () => {
    const stale = dlrReconcileStaleMs();
    const grace = dlrReconcileGraceMs();
    assert.ok(stale + grace >= 75 * 60 * 1000);
  });
});

describe('reconciliation batch scaling', () => {
  test('G: batch limit clamps env override', () => {
    const prev = process.env.WA_DLR_RECONCILE_BATCH_LIMIT;
    process.env.WA_DLR_RECONCILE_BATCH_LIMIT = '9999';
    assert.equal(reconcileBatchLimit(), 500);
    process.env.WA_DLR_RECONCILE_BATCH_LIMIT = '50';
    assert.equal(reconcileBatchLimit(), 50);
    if (prev != null) process.env.WA_DLR_RECONCILE_BATCH_LIMIT = prev;
    else delete process.env.WA_DLR_RECONCILE_BATCH_LIMIT;
  });

  test('max passes defaults to 3', () => {
    const prev = process.env.WA_DLR_RECONCILE_MAX_PASSES;
    delete process.env.WA_DLR_RECONCILE_MAX_PASSES;
    assert.equal(reconcileMaxPasses(), 3);
    if (prev != null) process.env.WA_DLR_RECONCILE_MAX_PASSES = prev;
  });
});
