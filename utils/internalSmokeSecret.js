'use strict';

const crypto = require('crypto');

function isProductionEnv() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function getInternalSmokeSecret() {
  const secret = process.env.INTERNAL_SMOKE_TEST_SECRET;
  if (!secret || !String(secret).trim()) return null;
  return String(secret).trim();
}

/**
 * Endpoint is mounted only when production + secret configured.
 */
function isInternalSmokeEndpointEnabled() {
  return isProductionEnv() && Boolean(getInternalSmokeSecret());
}

function timingSafeEqualStrings(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractInternalSmokeCredential(req) {
  if (!req) return '';
  const header = req.headers['x-internal-smoke-secret'] || req.headers['x-smoke-secret'];
  if (header != null && String(header).trim()) return String(header).trim();
  const auth = req.headers.authorization || req.headers.Authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  if (req.query && req.query.key != null) return String(req.query.key).trim();
  if (req.body && typeof req.body === 'object' && req.body.secret != null) {
    return String(req.body.secret).trim();
  }
  return '';
}

function isValidInternalSmokeSecret(provided) {
  const expected = getInternalSmokeSecret();
  if (!expected) return false;
  return timingSafeEqualStrings(provided, expected);
}

module.exports = {
  isProductionEnv,
  getInternalSmokeSecret,
  isInternalSmokeEndpointEnabled,
  extractInternalSmokeCredential,
  isValidInternalSmokeSecret,
};
