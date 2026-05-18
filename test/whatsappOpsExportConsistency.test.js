const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { assignRecipientBucket, toCanonicalExclusionReason } = require('../services/whatsappOpsCanonicalMetrics');

describe('export consistency', () => {
  test('E: export row canonical fields align with bucket rules', () => {
    const row = {
      anyDelivered: 0,
      anyReconcilePending: 1,
      lastStatus: 'awaiting_final_dlr',
      lastExclusionReason: null
    };
    const bucket = assignRecipientBucket({
      everDelivered: row.anyDelivered,
      anyReconcilePending: row.anyReconcilePending,
      finalUnresolved: 1,
      finalPermanentFailed: 0
    });
    const reason = toCanonicalExclusionReason({
      status: row.lastStatus,
      anyReconcilePending: row.anyReconcilePending,
      retryExclusionReason: row.lastExclusionReason
    });
    assert.equal(bucket, 'reconcile_pending');
    assert.equal(reason, 'reconcile_pending');
  });
});
