/**
 * Cron auth for /api/cron/* — supports a dedicated name if CRON_SECRET is used elsewhere.
 * Accepts either GUIDEXPERT_CRON_SECRET or CRON_SECRET (both may be set; request must match one).
 */

function getAcceptableCronSecrets() {
  const raw = [process.env.GUIDEXPERT_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean);
  return [...new Set(raw)];
}

function hasCronSecretConfigured() {
  return getAcceptableCronSecrets().length > 0;
}

/** For ?key= on internal fetch — prefers GUIDEXPERT_CRON_SECRET when set. */
function getCronSecretForOutboundPing() {
  return process.env.GUIDEXPERT_CRON_SECRET || process.env.CRON_SECRET || null;
}

function isValidCronSecret(providedKey) {
  if (!providedKey || typeof providedKey !== 'string') return false;
  return getAcceptableCronSecrets().includes(providedKey);
}

module.exports = {
  getAcceptableCronSecrets,
  hasCronSecretConfigured,
  getCronSecretForOutboundPing,
  isValidCronSecret,
};
