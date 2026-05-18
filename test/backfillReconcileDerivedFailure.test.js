const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMatchFilter } = require('../scripts/backfillReconcileDerivedFailure');

describe('backfillReconcileDerivedFailure', () => {
  test('B: match filter targets failed reconcile notes only', () => {
    const m = buildMatchFilter();
    assert.equal(m.status, 'failed');
    assert.equal(m.reconcileDerivedFailure.$ne, true);
    assert.equal(m.terminalFailureKind.$ne, 'permanent');
    assert.ok(Array.isArray(m.$or));
    assert.equal(m.$or.length, 3);
  });
});
