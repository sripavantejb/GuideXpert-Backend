const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  filterRetryPromotionRows,
  RETRY_EXCLUSION_REASON,
  getRetryPolicy,
  isCampaignStrategy,
  isImmediateOnlyStrategy,
  isRetryableFailure
} = require('../utils/whatsappRetryRules');

describe('filterRetryPromotionRows (50 → 20 → 5 style exclusions)', () => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  const mk = (phone, status, overrides = {}) => ({
    phone,
    status,
    failedAt: new Date(cutoff - 60_000),
    updatedAt: new Date(cutoff - 60_000),
    createdAt: new Date(cutoff - 60_000),
    retryEligible: true,
    ...overrides
  });

  test('excludes phones with delivered/read anywhere in group (success path)', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => mk(String(9000000000 + i), 'failed'));
    const neverRetry = Array.from({ length: 30 }, (_, i) => String(9000000000 + i));

    const out = filterRetryPromotionRows(fifty, {
      neverRetryPhones: neverRetry,
      alreadyPromotedPhones: [],
      cooldownCutoffMs: 5 * 60 * 1000
    });
    assert.equal(out.includedRows.length, 20);
    assert.equal(out.exclusionCounts[RETRY_EXCLUSION_REASON.alreadyDeliveredOrRead], 30);
  });

  test('excludes phones already promoted to next attempt slice', () => {
    const rows = [mk('8111111111', 'failed'), mk('8222222222', 'failed'), mk('8333333333', 'failed')];
    const out = filterRetryPromotionRows(rows, {
      neverRetryPhones: [],
      alreadyPromotedPhones: ['8111111111', '8333333333'],
      cooldownCutoffMs: 5 * 60 * 1000
    });
    assert.equal(out.includedRows.length, 1);
    assert.equal(out.includedRows[0].phone, '8222222222');
    assert.equal(out.exclusionCounts[RETRY_EXCLUSION_REASON.duplicateRetryPrevented], 2);
  });

  test('respects cooldown (too recent failures omitted)', () => {
    const rows = [mk('8444444444', 'failed'), mk('8555555555', 'failed')];
    rows[0].failedAt = new Date();
    const out = filterRetryPromotionRows(rows, {
      neverRetryPhones: [],
      alreadyPromotedPhones: [],
      cooldownCutoffMs: 5 * 60 * 1000
    });
    assert.equal(out.includedRows.length, 1);
    assert.equal(out.includedRows[0].phone, '8555555555');
    assert.equal(out.exclusionCounts[RETRY_EXCLUSION_REASON.cooldownBlocked], 1);
  });

  test('duplicate trigger guard: retryEligible false skips', () => {
    const rows = [mk('8666666666', 'failed', { retryEligible: false })];
    const out = filterRetryPromotionRows(rows, {
      neverRetryPhones: [],
      alreadyPromotedPhones: [],
      cooldownCutoffMs: 0
    });
    assert.equal(out.includedRows.length, 0);
    assert.equal(out.exclusionCounts[RETRY_EXCLUSION_REASON.retryEligibilityDisabled], 1);
  });
});

describe('template-specific retry policy behavior', () => {
  test('slot_booked is immediate-only with max 2 attempts', () => {
    const p = getRetryPolicy('slot_booked');
    assert.equal(p.strategy, 'immediate_only');
    assert.equal(p.maxAttempts, 2);
    assert.equal(isImmediateOnlyStrategy('slot_booked'), true);
    assert.equal(isCampaignStrategy('slot_booked'), false);
  });

  test('reminder templates are campaign-style', () => {
    assert.equal(isCampaignStrategy('pre4hr'), true);
    assert.equal(isCampaignStrategy('meet'), true);
    assert.equal(isCampaignStrategy('30min'), true);
  });

  test('slot_booked retry classifier allows transient but blocks permanent failures', () => {
    assert.equal(isRetryableFailure('slot_booked', { errorText: 'network timeout from provider' }), true);
    assert.equal(isRetryableFailure('slot_booked', { errorReason: 'invalid number not whatsapp' }), false);
    assert.equal(isRetryableFailure('slot_booked', { errorReason: 'user blocked business' }), false);
  });

  test('campaign templates are retryable regardless of error classification helper', () => {
    assert.equal(isRetryableFailure('pre4hr', { errorReason: 'invalid number' }), true);
  });
});
