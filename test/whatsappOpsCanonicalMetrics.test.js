const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecipientOutcomeBreakdown,
  rollupRecipientTotals,
  buildRecipientExclusionBreakdown,
  buildRecipientFailureReasonBreakdown,
  buildRetryFunnelReconciliation,
  toCanonicalExclusionReason,
  assignRecipientBucket,
  OPS_EXCLUSION_TAXONOMY
} = require('../services/whatsappOpsCanonicalMetrics');

describe('whatsappOpsCanonicalMetrics', () => {
  test('A: recipient dedupe — three attempts one delivered counts once', () => {
    const rows = [
      {
        everDelivered: 1,
        everRead: 0,
        finalPermanentFailed: 0,
        anyReconcilePending: 0,
        finalUnresolved: 0
      }
    ];
    const t = rollupRecipientTotals(rows);
    assert.equal(t.delivered, 1);
    assert.equal(t.totalRecipients, 1);
  });

  test('B: funnel reconciliation lists carried and recovered', () => {
    const rows = [
      {
        everDelivered: 1,
        firstDeliveredAttempt: 2,
        anyFailAttempt1: 1,
        finalUnresolved: 0,
        anyReconcilePending: 0,
        finalPermanentFailed: 0,
        anyExcluded: 0,
        anyExhausted: 0
      },
      {
        everDelivered: 0,
        firstDeliveredAttempt: null,
        anyFailAttempt1: 1,
        finalUnresolved: 1,
        anyReconcilePending: 0,
        finalPermanentFailed: 0,
        anyExcluded: 0,
        anyExhausted: 0
      }
    ];
    const bridges = buildRetryFunnelReconciliation(rows);
    assert.ok(bridges.length >= 1);
    const b12 = bridges.find((b) => b.fromAttempt === 1 && b.toAttempt === 2);
    assert.ok(b12);
    assert.equal(b12.recoveredOnRetry, 1);
  });

  test('C: cross-day — same phone two rollup rows', () => {
    const rows = [
      { everDelivered: 1, finalPermanentFailed: 0, anyReconcilePending: 0, finalUnresolved: 0 },
      { everDelivered: 0, finalPermanentFailed: 1, anyReconcilePending: 0, finalUnresolved: 0 }
    ];
    const b = buildRecipientOutcomeBreakdown(rows);
    assert.equal(b.total, 2);
    assert.equal(b.delivered, 1);
    assert.equal(b.permanentFailed, 1);
  });

  test('G: exclusion taxonomy maps raw reason', () => {
    assert.equal(
      toCanonicalExclusionReason({ retryExclusionReason: 'cooldown_blocked' }),
      OPS_EXCLUSION_TAXONOMY.cooldown_blocked
    );
    assert.equal(
      toCanonicalExclusionReason({ status: 'awaiting_final_dlr', anyReconcilePending: 1 }),
      OPS_EXCLUSION_TAXONOMY.reconcile_pending
    );
  });

  test('assignRecipientBucket precedence', () => {
    assert.equal(
      assignRecipientBucket({ everDelivered: 1, finalPermanentFailed: 1 }),
      'delivered'
    );
    assert.equal(
      assignRecipientBucket({
        everDelivered: 0,
        finalPermanentFailed: 0,
        anyReconcilePending: 1,
        finalUnresolved: 1
      }),
      'reconcile_pending'
    );
  });

  test('failure reason breakdown counts recipients not terminal events', () => {
    const rows = buildRecipientFailureReasonBreakdown([
      { everDelivered: 0, finalPermanentFailed: 1, lastWebhookErrorReason: 'invalid number' },
      { everDelivered: 0, finalPermanentFailed: 1, lastWebhookErrorReason: 'invalid number' }
    ]);
    const invalid = rows.find((r) => r._id === 'invalid_whatsapp');
    assert.equal(invalid?.count, 2);
  });

  test('recipient exclusion breakdown counts recipients not events', () => {
    const { exclusionBreakdown, excludedTotal } = buildRecipientExclusionBreakdown([
      { anyExcluded: 1, lastExclusionReason: 'cooldown_blocked' },
      { anyExcluded: 1, lastExclusionReason: 'cooldown_blocked' }
    ]);
    assert.equal(excludedTotal, 2);
    assert.equal(exclusionBreakdown.cooldown_blocked, 2);
  });
});
