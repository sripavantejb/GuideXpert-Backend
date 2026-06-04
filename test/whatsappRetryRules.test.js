const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  filterRetryPromotionRows,
  filterRetryPromotionRowsV2,
  RETRY_EXCLUSION_REASON,
  getRetryPolicy,
  isCampaignStrategy,
  isImmediateOnlyStrategy,
  isRetryableFailure,
  getRetryDelayMsAfterAttempt,
  retrySourceFromAttemptNumber,
  IN_FLIGHT_PROMOTION_STATUSES,
  RETRY_TERMINAL_SUCCESS_STATUSES,
  PROMOTION_BLOCK_SUCCESS_STATUSES,
  classifyCampaignFailure,
  campaignRetryMaxWallMs,
  dlrReconcileStaleMs,
  dlrReconcileGraceMs,
  RECONCILE_PENDING_STATUSES,
  isReconcileDerivedTerminal,
  isReconcileGraceActive,
  isManualRecoveryBlocked,
  isRiskyReconcileRecovery,
  classifyReconcileFinalizeFailure
} = require('../utils/whatsappRetryRules');

describe('IN_FLIGHT_PROMOTION_STATUSES vs retry-terminal', () => {
  test('submitted/sent are not promotable in-flight (provider-accepted = retry terminal)', () => {
    assert.equal(IN_FLIGHT_PROMOTION_STATUSES.includes('submitted'), false);
    assert.equal(IN_FLIGHT_PROMOTION_STATUSES.includes('sent'), false);
    assert.equal(RETRY_TERMINAL_SUCCESS_STATUSES.includes('submitted'), true);
    assert.equal(RETRY_TERMINAL_SUCCESS_STATUSES.includes('sent'), true);
  });
});

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

  test('campaign templates treat permanent-pattern errors as non-retryable', () => {
    assert.equal(isRetryableFailure('pre4hr', { errorReason: 'invalid number not on whatsapp' }), false);
    assert.equal(isRetryableFailure('meet', { errorText: 'user blocked business' }), false);
    assert.equal(isRetryableFailure('30min', { errorText: 'network timeout' }), true);
  });
});

describe('filterRetryPromotionRowsV2 (per-row eligibleAtMs)', () => {
  const now = Date.now();
  const row = (phone, eligibleAtMs, overrides = {}) => ({
    phone,
    eligibleAtMs,
    retryEligible: true,
    ...overrides
  });

  test('omits rows until eligibleAtMs <= now', () => {
    const out = filterRetryPromotionRowsV2(
      [row('9111111111', now + 60_000), row('9222222222', now - 1)],
      { neverRetryPhones: [], alreadyPromotedPhones: [] }
    );
    assert.equal(out.includedRows.length, 1);
    assert.equal(out.includedRows[0].phone, '9222222222');
    assert.equal(out.exclusionCounts[RETRY_EXCLUSION_REASON.cooldownBlocked], 1);
  });
});

describe('getRetryDelayMsAfterAttempt', () => {
  test('uses policy retryDelayMinutes index by fromAttempt', () => {
    const ms = getRetryDelayMsAfterAttempt('pre4hr', 1);
    assert.ok(ms >= 60_000);
  });
});

describe('retrySourceFromAttemptNumber', () => {
  test('attempts beyond 3 map to manual_recovery', () => {
    assert.equal(retrySourceFromAttemptNumber(4), 'manual_recovery');
    assert.equal(retrySourceFromAttemptNumber(6), 'manual_recovery');
  });
});

describe('PROMOTION_BLOCK_SUCCESS_STATUSES', () => {
  test('blocks promotion only on delivered/read, not submitted/sent', () => {
    assert.deepEqual(PROMOTION_BLOCK_SUCCESS_STATUSES, ['delivered', 'read']);
    assert.equal(PROMOTION_BLOCK_SUCCESS_STATUSES.includes('submitted'), false);
    assert.equal(PROMOTION_BLOCK_SUCCESS_STATUSES.includes('sent'), false);
  });
});

describe('classifyCampaignFailure (DLR after provider accept)', () => {
  test('permanent webhook failure after accept is not retryable', () => {
    const r = classifyCampaignFailure(
      'pre4hr',
      { errorReason: 'invalid number not on whatsapp' },
      { afterProviderAccept: true, attemptNumber: 1 }
    );
    assert.equal(r.retryable, false);
    assert.equal(r.terminalFailureKind, 'permanent');
    assert.equal(r.exclusionReason, RETRY_EXCLUSION_REASON.permanentFailure);
  });

  test('transient timeout after accept on attempt 1 is retryable', () => {
    const r = classifyCampaignFailure(
      'meet',
      { errorText: 'network timeout from provider' },
      { afterProviderAccept: true, attemptNumber: 1 }
    );
    assert.equal(r.retryable, true);
    assert.equal(r.terminalFailureKind, 'transient');
    assert.equal(r.exclusionReason, null);
  });

  test('ambiguous DLR failure after accept uses dlr_failed_after_accept', () => {
    const r = classifyCampaignFailure(
      '30min',
      { errorReason: 'unknown delivery error code 999' },
      { afterProviderAccept: true, attemptNumber: 2 }
    );
    assert.equal(r.retryable, false);
    assert.equal(r.exclusionReason, RETRY_EXCLUSION_REASON.dlrFailedAfterAccept);
  });

  test('iit_pre2hr 132012 after accept is retryable on attempt 1', () => {
    const r = classifyCampaignFailure(
      'iit_pre2hr',
      {
        errorCode: '132012',
        errorReason: '(#132012) Parameter format does not match format in the created template',
      },
      { afterProviderAccept: true, attemptNumber: 1 }
    );
    assert.equal(r.retryable, true);
    assert.equal(r.metaNote, 'iit_pre2hr_template_param_retry');
    assert.equal(r.exclusionReason, null);
  });
});

describe('reconcile pending lifecycle helpers', () => {
  test('awaiting_final_dlr is reconcile pending not terminal success', () => {
    assert.deepEqual(RECONCILE_PENDING_STATUSES, ['awaiting_final_dlr']);
    assert.equal(isReconcileDerivedTerminal({ status: 'failed', reconcileDerivedFailure: true }), true);
    assert.equal(isReconcileDerivedTerminal({ status: 'failed', reconcileDerivedFailure: false }), false);
  });

  test('default reconcile grace is 30 minutes', () => {
    const prev = process.env.WA_DLR_RECONCILE_GRACE_MS;
    delete process.env.WA_DLR_RECONCILE_GRACE_MS;
    assert.equal(dlrReconcileGraceMs(), 30 * 60 * 1000);
    if (prev != null) process.env.WA_DLR_RECONCILE_GRACE_MS = prev;
  });
});

describe('manual recovery reconcile guards', () => {
  const now = new Date('2026-05-18T12:00:00.000Z');

  test('A: awaiting_final_dlr blocks manual recovery', () => {
    assert.equal(
      isManualRecoveryBlocked({ status: 'awaiting_final_dlr', reconcileFinalityUntil: new Date(now.getTime() + 60000) }, now),
      true
    );
  });

  test('grace until future blocks manual recovery', () => {
    assert.equal(
      isManualRecoveryBlocked({ status: 'failed', reconcileFinalityUntil: new Date(now.getTime() + 60000) }, now),
      true
    );
  });

  test('reconcile-derived failed after finality is risky not blocked', () => {
    const row = {
      status: 'failed',
      reconcileDerivedFailure: true,
      reconcileFinalityUntil: new Date(now.getTime() - 60000)
    };
    assert.equal(isManualRecoveryBlocked(row, now), false);
    assert.equal(isRiskyReconcileRecovery(row, now), true);
  });
});

describe('classifyReconcileFinalizeFailure', () => {
  test('E: likely transient stale after accept at attempt 1 is retryable', () => {
    const r = classifyReconcileFinalizeFailure(
      'pre4hr',
      {
        attemptNumber: 1,
        providerAcceptedAt: new Date(),
        errorMessage: 'stale_dlr_no_resolution'
      },
      {}
    );
    assert.equal(r.retryable, true);
    assert.equal(r.metaNote, 'reconcile_stale_likely_transient');
  });

  test('permanent webhook hay is not retryable', () => {
    const r = classifyReconcileFinalizeFailure(
      'pre4hr',
      {
        attemptNumber: 1,
        providerAcceptedAt: new Date(),
        errorReason: 'not whatsapp user'
      },
      {}
    );
    assert.equal(r.retryable, false);
    assert.equal(r.terminalFailureKind, 'permanent');
  });
});

describe('one_on_one_submit immediate-only policy', () => {
  test('matches slot_booked immediate_only shape', () => {
    const p = getRetryPolicy('one_on_one_submit');
    assert.equal(p.strategy, 'immediate_only');
    assert.equal(p.maxAttempts, 2);
    assert.equal(p.retryTransientOnly, true);
    assert.equal(isImmediateOnlyStrategy('one_on_one_submit'), true);
    assert.equal(isCampaignStrategy('one_on_one_submit'), false);
  });
});

describe('guidance_booking_submit immediate-only policy', () => {
  test('matches one_on_one_submit immediate_only shape', () => {
    const p = getRetryPolicy('guidance_booking_submit');
    assert.equal(p.strategy, 'immediate_only');
    assert.equal(p.maxAttempts, 2);
    assert.equal(p.retryTransientOnly, true);
    assert.equal(isImmediateOnlyStrategy('guidance_booking_submit'), true);
    assert.equal(isCampaignStrategy('guidance_booking_submit'), false);
  });
});

describe('campaign retry wall and reconcile stale defaults', () => {
  test('default retry wall is 15 minutes', () => {
    const prev = process.env.WHATSAPP_CAMPAIGN_RETRY_MAX_WALL_MS;
    delete process.env.WHATSAPP_CAMPAIGN_RETRY_MAX_WALL_MS;
    assert.equal(campaignRetryMaxWallMs(), 900000);
    if (prev != null) process.env.WHATSAPP_CAMPAIGN_RETRY_MAX_WALL_MS = prev;
  });

  test('default DLR reconcile stale is at least 45 minutes', () => {
    const prev = process.env.WA_DLR_RECONCILE_STALE_MS;
    delete process.env.WA_DLR_RECONCILE_STALE_MS;
    assert.ok(dlrReconcileStaleMs() >= 45 * 60 * 1000);
    if (prev != null) process.env.WA_DLR_RECONCILE_STALE_MS = prev;
  });
});
