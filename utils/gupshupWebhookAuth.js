const crypto = require('crypto');

function isProductionEnv() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * Whether webhook requests must present a valid shared secret.
 *
 * - GUPSHUP_WEBHOOK_AUTH_REQUIRED=0 → never enforce (e.g. Gupshup dev callback without headers)
 * - GUPSHUP_WEBHOOK_AUTH_REQUIRED=1 → always enforce (503 if secret missing)
 * - Default → enforce only when GUPSHUP_WEBHOOK_SECRET is set (allows inbound until you configure secret)
 */
function isWebhookAuthEnforced() {
  const authFlag = String(process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED || '').trim();
  if (authFlag === '0') return false;
  if (authFlag === '1') return true;
  return Boolean(getConfiguredWebhookSecret());
}

function getConfiguredWebhookSecret() {
  const secret = process.env.GUPSHUP_WEBHOOK_SECRET;
  if (!secret || !String(secret).trim()) return null;
  return String(secret).trim();
}

function extractWebhookCredential(req) {
  if (!req) return '';
  const header =
    req.headers['x-gupshup-signature'] ||
    req.headers['x-webhook-secret'] ||
    (req.query && req.query.secret);
  return header != null ? String(header) : '';
}

function timingSafeEqualStrings(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * @param {import('express').Request} req
 * @returns {{ ok: boolean, statusCode?: number, error?: string }}
 */
function verifyGupshupWebhookRequest(req) {
  const enforced = isWebhookAuthEnforced();
  const secret = getConfiguredWebhookSecret();

  if (enforced && !secret) {
    return {
      ok: false,
      statusCode: 503,
      error: 'webhook_secret_not_configured',
    };
  }

  if (!enforced) {
    return { ok: true };
  }

  const provided = extractWebhookCredential(req);
  if (!provided || !timingSafeEqualStrings(provided, secret)) {
    return { ok: false, statusCode: 401, error: 'unauthorized' };
  }

  return { ok: true };
}

module.exports = {
  isProductionEnv,
  isWebhookAuthEnforced,
  getConfiguredWebhookSecret,
  extractWebhookCredential,
  timingSafeEqualStrings,
  verifyGupshupWebhookRequest,
};
