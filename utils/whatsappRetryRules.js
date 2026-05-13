/** Statuses counting as terminal failure when choosing retry promotion candidates */
const TERMINAL_FAILURE_STATUSES = ['failed', 'retry_exhausted'];

/** Provider accepted or better — automated retries and promotions must not continue */
const RETRY_TERMINAL_SUCCESS_STATUSES = ['submitted', 'sent', 'delivered', 'read'];

/** Handset delivery / read — funnels and delivery-rate KPIs */
const DLR_DELIVERED_STATUSES = ['delivered', 'read'];

/** @deprecated Prefer DLR_DELIVERED_STATUSES for delivery KPIs or RETRY_TERMINAL_SUCCESS_STATUSES for retry cut-off */
const SUCCESS_TERMINAL_STATUSES = DLR_DELIVERED_STATUSES;

/** Rows that may still be promoted after staleness (never submitted/sent — those are retry-terminal) */
const IN_FLIGHT_PROMOTION_STATUSES = ['queued', 'retry_pending'];

function parseCommaSeparatedPositiveInts(raw, fallbackArr) {
  if (raw == null || String(raw).trim() === '') return [...fallbackArr];
  const parts = String(raw)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length ? parts : [...fallbackArr];
}

function parseCooldownMinutes(envKey, fallback) {
  const n = parseInt(process.env[envKey] || '', 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return fallback;
}

/** Built from env on each read so deploy-time env changes apply without restart in long-lived dev servers. */
function buildRetryPolicies() {
  return {
    slot_booked: {
      strategy: 'immediate_only',
      maxAttempts: 2,
      immediateRetryDelaySeconds: parseInt(process.env.WA_SLOT_BOOKED_RETRY_DELAY_SECONDS || '15', 10) || 15,
      retryTransientOnly: true,
      cooldownMinutes: 0
    },
    pre4hr: {
      strategy: 'multi_stage',
      maxAttempts: 3,
      retryDelayMinutes: parseCommaSeparatedPositiveInts(process.env.WA_PRE4HR_RETRY_DELAY_MINUTES, [1, 2]),
      cooldownMinutes: parseCooldownMinutes('WA_PRE4HR_RETRY_COOLDOWN_MINUTES', 0),
      classifyPermanentFailures: true
    },
    meet: {
      strategy: 'multi_stage',
      maxAttempts: 3,
      retryDelayMinutes: parseCommaSeparatedPositiveInts(process.env.WA_MEET_RETRY_DELAY_MINUTES, [1, 2]),
      cooldownMinutes: parseCooldownMinutes('WA_MEET_RETRY_COOLDOWN_MINUTES', 0),
      classifyPermanentFailures: true
    },
    '30min': {
      strategy: 'time_sensitive',
      maxAttempts: 2,
      retryDelayMinutes: parseCommaSeparatedPositiveInts(process.env.WA_30MIN_RETRY_DELAY_MINUTES, [1]),
      cooldownMinutes: parseCooldownMinutes('WA_30MIN_RETRY_COOLDOWN_MINUTES', 0),
      classifyPermanentFailures: true
    }
  };
}

const TRANSIENT_FAILURE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /temporar/i,
  /network/i,
  /econn/i,
  /socket/i,
  /5\d\d/,
  /provider.*down/i,
  /service unavailable/i,
  /rate.?limit/i
];

const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i,
  /not whatsapp/i,
  /no whatsapp/i,
  /whatsapp.*disabled/i,
  /disabled.*whatsapp/i,
  /user.*not.*registered/i,
  /not.*registered.*whatsapp/i,
  /opt.?out/i,
  /blocked/i,
  /blacklist/i,
  /does not exist/i,
  /rejected/i,
  /policy/i,
  /undeliverable/i,
  /unregistered/i
];

const RETRY_EXCLUSION_REASON = {
  alreadyDeliveredOrRead: 'already_delivered_or_read',
  duplicateRetryPrevented: 'duplicate_retry_prevented',
  retryEligibilityDisabled: 'retry_eligibility_disabled',
  cooldownBlocked: 'cooldown_blocked',
  missingPhone: 'missing_phone',
  missingRegisteredSubmission: 'missing_registered_submission',
  policyNonRetryable: 'policy_non_retryable',
  permanentFailure: 'permanent_failure',
  inFlightTimeout: 'in_flight_timeout',
  promotionSuperseded: 'promotion_superseded',
  outsideReminderValidity: 'outside_reminder_validity'
};

function getRetryPolicy(kind) {
  const policies = buildRetryPolicies();
  return (
    policies[kind] || {
      strategy: 'multi_stage',
      maxAttempts: 3,
      retryDelayMinutes: parseCommaSeparatedPositiveInts(
        process.env.WHATSAPP_RETRY_DELAY_MINUTES,
        [1, 2]
      ),
      cooldownMinutes: parseInt(process.env.WHATSAPP_RETRY_COOLDOWN_MINUTES || '0', 10) || 0,
      classifyPermanentFailures: true
    }
  );
}

function isCampaignStrategy(kind) {
  return getRetryPolicy(kind).strategy !== 'immediate_only';
}

function isImmediateOnlyStrategy(kind) {
  return getRetryPolicy(kind).strategy === 'immediate_only';
}

/**
 * Slot_booked: only transient errors retry. Campaigns: permanent patterns never retry;
 * transient retry; unknown/non-matching hay still retries (provider glitches).
 */
function isRetryableFailure(kind, { errorCode, errorReason, errorText } = {}) {
  const policy = getRetryPolicy(kind);
  const hay = [errorCode, errorReason, errorText].filter(Boolean).join(' | ');
  if (policy.retryTransientOnly) {
    if (!hay) return false;
    if (PERMANENT_FAILURE_PATTERNS.some((rx) => rx.test(hay))) return false;
    return TRANSIENT_FAILURE_PATTERNS.some((rx) => rx.test(hay));
  }
  if (policy.classifyPermanentFailures) {
    if (hay && PERMANENT_FAILURE_PATTERNS.some((rx) => rx.test(hay))) return false;
    return true;
  }
  if (!hay) return true;
  if (PERMANENT_FAILURE_PATTERNS.some((rx) => rx.test(hay))) return false;
  return TRANSIENT_FAILURE_PATTERNS.some((rx) => rx.test(hay));
}

function retryCooldownMsForKind(kind) {
  const p = getRetryPolicy(kind);
  return Math.max(0, Number(p.cooldownMinutes) || 0) * 60 * 1000;
}

/** Milliseconds to wait after `fromAttempt` finishes (terminal or stale) before promoting to `fromAttempt+1`. */
function getRetryDelayMsAfterAttempt(kind, fromAttempt) {
  const p = getRetryPolicy(kind);
  const idx = Number(fromAttempt) - 1;
  const arr = Array.isArray(p.retryDelayMinutes) ? p.retryDelayMinutes : [];
  const minutes = idx >= 0 && idx < arr.length ? Number(arr[idx]) : Number(arr[arr.length - 1]) || 5;
  const floor = retryCooldownMsForKind(kind);
  return Math.max(floor, Math.max(1, Number.isFinite(minutes) ? minutes : 5) * 60 * 1000);
}

/** Stale in-flight rows become promotion-eligible after this age (ms). */
function inFlightPromotionStaleMsForKind(kind) {
  if (kind === 'slot_booked') {
    return Math.max(
      60 * 1000,
      (parseInt(process.env.WA_SLOT_BOOKED_INFLIGHT_STALE_MS || '', 10) || 120000)
    );
  }
  return Math.max(
    60 * 1000,
    (parseInt(process.env.WA_CAMPAIGN_INFLIGHT_STALE_MS || '', 10) || 180000)
  );
}

/**
 * Rows at `fromAttempt` eligible for next promotion (per-row `eligibleAtMs` already computed vs `nowMs`).
 * @param {Array<{ phone: string, _id: any, retryEligible?: boolean, eligibleAtMs: number }>} rows
 * @param {{ neverRetryPhones: string[], alreadyPromotedPhones: string[] }} opts
 */
function filterRetryPromotionRowsV2(rows, opts) {
  const { neverRetryPhones, alreadyPromotedPhones } = opts;
  const banned = new Set(neverRetryPhones);
  const promoted = new Set(alreadyPromotedPhones);
  const now = Date.now();
  const includedRows = [];
  const excludedRows = [];
  const exclusionCounts = {};

  function pushExcluded(r, reason) {
    excludedRows.push({
      phone: r && r.phone ? r.phone : null,
      parentMessageEventId: r && r._id ? r._id : null,
      reason
    });
    exclusionCounts[reason] = (exclusionCounts[reason] || 0) + 1;
  }

  rows.forEach((r) => {
    const p = r.phone;
    if (!p) {
      pushExcluded(r, RETRY_EXCLUSION_REASON.missingPhone);
      return;
    }
    if (banned.has(p)) {
      pushExcluded(r, RETRY_EXCLUSION_REASON.alreadyDeliveredOrRead);
      return;
    }
    if (promoted.has(p)) {
      pushExcluded(r, RETRY_EXCLUSION_REASON.duplicateRetryPrevented);
      return;
    }
    if (r.retryEligible === false) {
      pushExcluded(r, RETRY_EXCLUSION_REASON.retryEligibilityDisabled);
      return;
    }
    const eligibleAt = Number.isFinite(r.eligibleAtMs) ? r.eligibleAtMs : 0;
    if (now < eligibleAt) {
      pushExcluded(r, RETRY_EXCLUSION_REASON.cooldownBlocked);
      return;
    }
    includedRows.push(r);
  });

  return { includedRows, excludedRows, exclusionCounts };
}

/**
 * Legacy wrapper: single cutoff = now - cooldownCutoffMs (old behavior).
 * @deprecated prefer filterRetryPromotionRowsV2 + per-row delays
 */
function filterRetryPromotionRows(failedStageRows, opts) {
  const { neverRetryPhones, alreadyPromotedPhones, cooldownCutoffMs } = opts;
  const now = Date.now();
  const cool = Number.isFinite(cooldownCutoffMs) ? cooldownCutoffMs : 0;
  const rows = (failedStageRows || []).map((r) => {
    const failedMs = r.failedAt ? new Date(r.failedAt).getTime() : now - cool - 1;
    const eligibleAtMs = failedMs + cool;
    return { ...r, eligibleAtMs };
  });
  return filterRetryPromotionRowsV2(rows, { neverRetryPhones, alreadyPromotedPhones });
}

function retrySourceFromAttemptNumber(n) {
  const a = Number(n) || 1;
  if (a <= 1) return 'initial';
  if (a === 2) return 'retry1';
  if (a === 3) return 'retry2';
  return 'manual_recovery';
}

module.exports = {
  /** @deprecated Use getRetryPolicy(); values are env-driven */
  get RETRY_POLICIES() {
    return buildRetryPolicies();
  },
  TERMINAL_FAILURE_STATUSES,
  RETRY_TERMINAL_SUCCESS_STATUSES,
  DLR_DELIVERED_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  IN_FLIGHT_PROMOTION_STATUSES,
  RETRY_EXCLUSION_REASON,
  filterRetryPromotionRows,
  filterRetryPromotionRowsV2,
  retrySourceFromAttemptNumber,
  getRetryPolicy,
  isCampaignStrategy,
  isImmediateOnlyStrategy,
  isRetryableFailure,
  retryCooldownMsForKind,
  getRetryDelayMsAfterAttempt,
  inFlightPromotionStaleMsForKind
};
