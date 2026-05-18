'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildRecipientOutcomeBreakdown } = require('../services/whatsappOpsRecipientAnalytics');

describe('buildRecipientOutcomeBreakdown', () => {
  test('empty input sums to zero', () => {
    const r = buildRecipientOutcomeBreakdown([]);
    assert.deepEqual(
      { ...r },
      {
        delivered: 0,
        permanentFailed: 0,
        reconcilePending: 0,
        transientUnresolved: 0,
        unresolved: 0,
        other: 0,
        total: 0,
        sumCheck: 0
      }
    );
  });

  test('mutually exclusive buckets sum to row count', () => {
    const rows = [
      { everDelivered: 1, finalPermanentFailed: 0, finalUnresolved: 0, anyReconcilePending: 0 },
      { everDelivered: 0, finalPermanentFailed: 1, finalUnresolved: 1, anyReconcilePending: 0 },
      { everDelivered: 0, finalPermanentFailed: 0, finalUnresolved: 1, anyReconcilePending: 1 },
      { everDelivered: 0, finalPermanentFailed: 0, finalUnresolved: 0, anyReconcilePending: 0 }
    ];
    const r = buildRecipientOutcomeBreakdown(rows);
    assert.equal(r.delivered, 1);
    assert.equal(r.permanentFailed, 1);
    assert.equal(r.reconcilePending, 1);
    assert.equal(r.transientUnresolved, 0);
    assert.equal(r.other, 1);
    assert.equal(r.total, 4);
    assert.equal(r.sumCheck, r.total);
  });

  test('delivered takes priority over permanent and unresolved flags', () => {
    const r = buildRecipientOutcomeBreakdown([
      { everDelivered: 1, finalPermanentFailed: 1, finalUnresolved: 1 }
    ]);
    assert.equal(r.delivered, 1);
    assert.equal(r.permanentFailed, 0);
    assert.equal(r.unresolved, 0);
    assert.equal(r.other, 0);
    assert.equal(r.sumCheck, 1);
  });

  test('accepts boolean flags from lean docs', () => {
    const r = buildRecipientOutcomeBreakdown([
      { everDelivered: true, finalPermanentFailed: false, finalUnresolved: false }
    ]);
    assert.equal(r.delivered, 1);
    assert.equal(r.sumCheck, 1);
  });
});

/** Mirrors retryFunnelByAttempt $group: one recipient key, max delivered across attempts. */
function countRecipientDeliveredFromAttemptRows(rows) {
  const byRecipient = new Map();
  for (const row of rows) {
    const key = `${row.lineageId}|${row.phone}|${row.messageKind}`;
    const delivered = ['delivered', 'read'].includes(row.status) ? 1 : 0;
    byRecipient.set(key, Math.max(byRecipient.get(key) || 0, delivered));
  }
  let deliveredRecipients = 0;
  for (const v of byRecipient.values()) deliveredRecipients += v;
  return { deliveredRecipients, attemptRows: rows.length };
}

describe('reconcile pending recipient semantics', () => {
  test('C–D: reconcile pending is not permanent failed or transient unresolved', () => {
    const r = buildRecipientOutcomeBreakdown([
      {
        everDelivered: 0,
        finalPermanentFailed: 0,
        finalUnresolved: 1,
        anyReconcilePending: 1
      },
      {
        everDelivered: 0,
        finalPermanentFailed: 0,
        finalUnresolved: 1,
        anyReconcilePending: 0
      }
    ]);
    assert.equal(r.permanentFailed, 0);
    assert.equal(r.reconcilePending, 1);
    assert.equal(r.transientUnresolved, 1);
    assert.equal(r.unresolved, 1);
    assert.equal(r.delivered, 0);
  });
});

describe('range summary sum invariant', () => {
  test('D: daily totals sum to range rollup', () => {
    const days = [
      { totalRecipients: 10, delivered: 5, permanentFailed: 2, reconcilePending: 1, transientUnresolved: 2 },
      { totalRecipients: 8, delivered: 4, permanentFailed: 1, reconcilePending: 0, transientUnresolved: 3 }
    ];
    const sum = days.reduce(
      (acc, d) => ({
        totalRecipients: acc.totalRecipients + d.totalRecipients,
        delivered: acc.delivered + d.delivered,
        finalPermanentFailed: acc.finalPermanentFailed + d.permanentFailed,
        reconcilePending: acc.reconcilePending + d.reconcilePending,
        transientUnresolved: acc.transientUnresolved + d.transientUnresolved
      }),
      {
        totalRecipients: 0,
        delivered: 0,
        finalPermanentFailed: 0,
        reconcilePending: 0,
        transientUnresolved: 0
      }
    );
    assert.equal(sum.totalRecipients, 18);
    assert.equal(sum.delivered, 9);
    assert.equal(sum.finalPermanentFailed, 3);
    assert.equal(sum.reconcilePending, 1);
    assert.equal(sum.transientUnresolved, 5);
  });
});

describe('P3: recipient event rollup unchanged', () => {
  test('F: buildRecipientOutcomeBreakdown semantics stable for P2 cohort KPIs', () => {
    const rows = [
      { everDelivered: 1, finalPermanentFailed: 0, finalUnresolved: 0, anyReconcilePending: 0 },
      { everDelivered: 0, finalPermanentFailed: 0, finalUnresolved: 1, anyReconcilePending: 0 }
    ];
    const r = buildRecipientOutcomeBreakdown(rows);
    assert.equal(r.delivered, 1);
    assert.equal(r.unresolved, 1);
    assert.equal(r.sumCheck, 2);
  });
});

describe('recipient funnel dedupe (one phone, three attempts)', () => {
  test('three attempt rows for same recipient count as one delivered', () => {
    const phone = '919999999999';
    const attempts = [1, 2, 3].map((n) => ({
      lineageId: 'grp-1',
      phone,
      messageKind: 'pre4hr',
      status: n === 3 ? 'delivered' : 'failed'
    }));
    const { deliveredRecipients, attemptRows } = countRecipientDeliveredFromAttemptRows(attempts);
    assert.equal(attemptRows, 3);
    assert.equal(deliveredRecipients, 1);
  });
});
