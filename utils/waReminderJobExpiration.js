/**
 * P3 hardening: per-template expiration windows for reminder jobs.
 */
const DEFAULT_30MIN_GRACE_MS = 15 * 60 * 1000;

function expireGraceMsForKind(kind) {
  if (kind === '30min' || kind === 'iit_pre15min') {
    const envKey = kind === 'iit_pre15min' ? 'WA_IIT_PRE15MIN_EXPIRE_GRACE_MS' : 'WA_30MIN_EXPIRE_GRACE_MS';
    const v = parseInt(process.env[envKey] || String(DEFAULT_30MIN_GRACE_MS), 10);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_30MIN_GRACE_MS;
  }
  return 0;
}

/**
 * @param {'pre4hr'|'meet'|'30min'} kind
 * @param {Date|string} slotDate
 * @returns {Date|null}
 */
function computeExpiresAt(kind, slotDate) {
  const slotMs = new Date(slotDate).getTime();
  if (Number.isNaN(slotMs)) return null;
  return new Date(slotMs + expireGraceMsForKind(kind));
}

function isJobExpired(job, now = new Date()) {
  if (!job || !job.expiresAt) return false;
  if (job.suppressionReason === 'expired') return true;
  return new Date(job.expiresAt).getTime() <= now.getTime();
}

module.exports = {
  computeExpiresAt,
  expireGraceMsForKind,
  isJobExpired,
  DEFAULT_30MIN_GRACE_MS
};
