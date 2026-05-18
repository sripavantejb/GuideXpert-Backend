const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRecipientAnalyticsInvariants } = require('../utils/waAnalyticsIntegrity');

describe('waAnalyticsIntegrity', () => {
  test('I: valid payload passes', () => {
    const r = validateRecipientAnalyticsInvariants({
      recipientTotals: {
        totalRecipients: 10,
        delivered: 5,
        finalPermanentFailed: 2,
        reconcilePending: 1,
        transientUnresolved: 1,
        excludedTotal: 1
      },
      outcomeBreakdown: {
        delivered: 5,
        permanentFailed: 2,
        reconcilePending: 1,
        transientUnresolved: 1,
        other: 1,
        total: 10
      }
    });
    assert.equal(r.ok, true);
    assert.equal(r.violations.length, 0);
  });

  test('I: mismatch detected', () => {
    const r = validateRecipientAnalyticsInvariants({
      recipientTotals: { totalRecipients: 10, excludedTotal: 20 },
      outcomeBreakdown: {
        delivered: 5,
        permanentFailed: 2,
        reconcilePending: 1,
        transientUnresolved: 1,
        other: 0,
        total: 9
      }
    });
    assert.equal(r.ok, false);
    assert.ok(r.violations.length > 0);
  });
});
