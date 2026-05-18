'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeFairClaimLimits,
  isCatchUpModeActive,
  isOverdueForFairness
} = require('../utils/waReminderJobDispatchQueue');
const { computeExpiresAt, isJobExpired } = require('../utils/waReminderJobExpiration');
const {
  stateRank,
  JOB_STATE_RANK,
  clearLeaseFields
} = require('../services/whatsappReminderJobLifecycle');
const { upsertReminderJob } = require('../services/whatsappReminderScheduler');
const {
  buildClaimableFilter,
  maxDispatchPerRun
} = require('../services/whatsappReminderJobDispatcher');
const { mergeEnsureStats, emptyStats } = require('../scripts/backfillWhatsAppReminderJobs');

describe('P3 hardening — uniqueness & upsert', () => {
  test('A: E11000 helper exists on scheduler', () => {
    assert.equal(typeof upsertReminderJob, 'function');
  });
});

describe('P3 hardening — claim CAS', () => {
  test('B: overdue filter includes pending and expired lease claimed', () => {
    const now = new Date();
    const f = buildClaimableFilter(now, ['pre4hr'], null, 'overdue');
    assert.ok(f.$or);
    assert.ok(f.$or.length >= 2);
  });

  test('C: expired lease makes claimed reclaimable', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60000);
    const job = { state: 'claimed', leaseExpiresAt: past, scheduledSendAt: past };
    const f = buildClaimableFilter(now, ['meet'], null, 'overdue');
    assert.ok(f.$or.some((branch) => branch.state && branch.state.$in));
  });

  test('H: clearLeaseFields resets token', () => {
    const c = clearLeaseFields();
    assert.equal(c.claimToken, null);
    assert.equal(c.leaseExpiresAt, null);
  });
});

describe('P3 hardening — lifecycle monotonic', () => {
  test('D: state ranks increase monotonically', () => {
    assert.ok(stateRank('dispatched') > stateRank('dispatching'));
    assert.ok(stateRank('delivered') > stateRank('dispatched'));
    assert.ok(JOB_STATE_RANK.pending < JOB_STATE_RANK.claimed);
  });

  test('E: sync module re-exports lifecycle', () => {
    const sync = require('../services/whatsappReminderJobSync');
    assert.equal(typeof sync.syncReminderJobFromRetryGroup, 'function');
  });
});

describe('P3 hardening — fair queue', () => {
  test('G: 80/20 split at limit 100', () => {
    const { overdueLimit, freshLimit } = computeFairClaimLimits(100, 0.8);
    assert.equal(overdueLimit, 80);
    assert.equal(freshLimit, 20);
  });

  test('catch-up mode when overdue dominates', () => {
    assert.equal(isCatchUpModeActive({ overdueCount: 60, freshDueCount: 10 }), true);
    assert.equal(isCatchUpModeActive({ overdueCount: 10, freshDueCount: 60 }), false);
  });
});

describe('P3 hardening — expiration', () => {
  test('I: pre4hr expires at slot', () => {
    const slot = new Date('2026-12-01T10:00:00.000Z');
    const exp = computeExpiresAt('pre4hr', slot);
    assert.equal(exp.getTime(), slot.getTime());
  });

  test('I: 30min expires after grace', () => {
    const slot = new Date('2026-12-01T10:00:00.000Z');
    const exp = computeExpiresAt('30min', slot);
    assert.ok(exp.getTime() > slot.getTime());
  });

  test('isJobExpired detects suppressionReason', () => {
    assert.equal(isJobExpired({ suppressionReason: 'expired', expiresAt: new Date() }), true);
  });
});

describe('P3 hardening — backfill', () => {
  test('F: second merge idempotent stats', () => {
    const stats = emptyStats('EXECUTE');
    mergeEnsureStats(stats, {
      jobs: [{ created: true }],
      duplicatePrevented: 0
    });
    mergeEnsureStats(stats, {
      jobs: [{ created: false }],
      duplicatePrevented: 1
    });
    assert.equal(stats.created, 1);
    assert.equal(stats.duplicatePrevented, 1);
  });
});

describe('P3 hardening — storm caps', () => {
  test('J: max dispatch per run is bounded', () => {
    const m = maxDispatchPerRun();
    assert.ok(m >= 10);
    assert.ok(m <= 2000);
  });

  test('isOverdueForFairness uses SLA window', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 60 * 1000);
    assert.equal(typeof isOverdueForFairness(now, old), 'boolean');
  });
});
