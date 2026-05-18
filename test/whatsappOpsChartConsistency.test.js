const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecipientOutcomeBreakdown } = require('../services/whatsappOpsCanonicalMetrics');

describe('chart field parity', () => {
  test('H: month day shape matches outcome breakdown buckets', () => {
    const dayRow = {
      delivered: 3,
      permanentFailed: 1,
      reconcilePending: 2,
      transientUnresolved: 4,
      unresolved: 4,
      totalRecipients: 10
    };
    const fromBreakdown = buildRecipientOutcomeBreakdown([
      { everDelivered: 1 },
      { everDelivered: 1 },
      { everDelivered: 1 },
      { finalPermanentFailed: 1 },
      { anyReconcilePending: 1 },
      { anyReconcilePending: 1 },
      { finalUnresolved: 1, anyReconcilePending: 0, finalPermanentFailed: 0 },
      { finalUnresolved: 1, anyReconcilePending: 0, finalPermanentFailed: 0 },
      { finalUnresolved: 1, anyReconcilePending: 0, finalPermanentFailed: 0 },
      { finalUnresolved: 1, anyReconcilePending: 0, finalPermanentFailed: 0 }
    ]);
    assert.equal(dayRow.delivered, fromBreakdown.delivered);
    assert.equal(dayRow.permanentFailed, fromBreakdown.permanentFailed);
    assert.equal(dayRow.reconcilePending, fromBreakdown.reconcilePending);
    assert.equal(dayRow.transientUnresolved, fromBreakdown.transientUnresolved);
  });
});
