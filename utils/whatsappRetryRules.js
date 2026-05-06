/** Statuses counting as terminal failure when choosing retry promotion candidates */
const TERMINAL_FAILURE_STATUSES = ['failed', 'retry_exhausted'];

/** Statuses meaning this recipient never gets another WA attempt in-group */
const SUCCESS_TERMINAL_STATUSES = ['delivered', 'read'];

const RETRY_POLICIES = {
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
    retryDelayMinutes: [5, 15],
    cooldownMinutes: parseInt(process.env.WA_PRE4HR_RETRY_COOLDOWN_MINUTES || '5', 10) || 5
  },
  meet: {
    strategy: 'multi_stage',
    maxAttempts: 3,
    retryDelayMinutes: [5, 10],
    cooldownMinutes: parseInt(process.env.WA_MEET_RETRY_COOLDOWN_MINUTES || '5', 10) || 5
  },
  '30min': {
    strategy: 'time_sensitive',
    maxAttempts: 2,
    retryDelayMinutes: [2],
    cooldownMinutes: parseInt(process.env.WA_30MIN_RETRY_COOLDOWN_MINUTES || '2', 10) || 2
  }
};

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
  /opt.?out/i,
  /blocked/i,
  /blacklist/i,
  /does not exist/i
];

function getRetryPolicy(kind) {
  return RETRY_POLICIES[kind] || {
    strategy: 'multi_stage',
    maxAttempts: 3,
    retryDelayMinutes: [5, 15],
    cooldownMinutes: parseInt(process.env.WHATSAPP_RETRY_COOLDOWN_MINUTES || '5', 10) || 5
  };
}

function isCampaignStrategy(kind) {
  return getRetryPolicy(kind).strategy !== 'immediate_only';
}

function isImmediateOnlyStrategy(kind) {
  return getRetryPolicy(kind).strategy === 'immediate_only';
}

function isRetryableFailure(kind, { errorCode, errorReason, errorText } = {}) {
  const policy = getRetryPolicy(kind);
  if (!policy.retryTransientOnly) return true;
  const hay = [errorCode, errorReason, errorText].filter(Boolean).join(' | ');
  if (!hay) return false;
  if (PERMANENT_FAILURE_PATTERNS.some((rx) => rx.test(hay))) return false;
  return TRANSIENT_FAILURE_PATTERNS.some((rx) => rx.test(hay));
}

function retryCooldownMsForKind(kind) {
  const p = getRetryPolicy(kind);
  return Math.max(0, Number(p.cooldownMinutes) || 0) * 60 * 1000;
}

/**
 * Rows at `fromAttempt` that failed Webhook/send, minus exclusion sets and cooldown window.
 * @param {Array<{ phone: string, failedAt?: Date, updatedAt?: Date, createdAt?: Date, retryEligible?: boolean }>} failedStageRows
 * @param {{ neverRetryPhones: string[], alreadyPromotedPhones: string[], cooldownCutoffMs: number }} opts
 */
function filterRetryPromotionRows(failedStageRows, opts) {
  const { neverRetryPhones, alreadyPromotedPhones, cooldownCutoffMs } = opts;
  const banned = new Set(neverRetryPhones);
  const promoted = new Set(alreadyPromotedPhones);
  const now = Date.now();
  const cutoff = now - (Number.isFinite(cooldownCutoffMs) ? cooldownCutoffMs : 0);
  return failedStageRows.filter((r) => {
    const p = r.phone;
    if (!p || banned.has(p)) return false;
    if (promoted.has(p)) return false;
    if (r.retryEligible === false) return false;
    const t = new Date(r.failedAt || r.updatedAt || r.createdAt || now).getTime();
    if (Number.isFinite(t) && t > cutoff) return false;
    return true;
  });
}

function retrySourceFromAttemptNumber(n) {
  const a = Number(n) || 1;
  if (a <= 1) return 'initial';
  if (a === 2) return 'retry1';
  return 'retry2';
}

module.exports = {
  RETRY_POLICIES,
  TERMINAL_FAILURE_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  filterRetryPromotionRows,
  retrySourceFromAttemptNumber,
  getRetryPolicy,
  isCampaignStrategy,
  isImmediateOnlyStrategy,
  isRetryableFailure,
  retryCooldownMsForKind
};
