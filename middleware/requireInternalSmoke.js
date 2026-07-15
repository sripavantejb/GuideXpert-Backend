'use strict';

const {
  isProductionEnv,
  getInternalSmokeSecret,
  extractInternalSmokeCredential,
  isValidInternalSmokeSecret,
} = require('../utils/internalSmokeSecret');
const { maskPhoneTail } = require('../utils/chatbotPhone');

const globalWindow = { start: 0, count: 0 };
const phoneWindows = new Map();

function parsePositiveInt(value, fallback) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bumpWindow(entry, now, windowMs) {
  if (!entry || now - entry.start > windowMs) {
    return { start: now, count: 1 };
  }
  return { start: entry.start, count: entry.count + 1 };
}

function checkRateLimit(phone10) {
  const now = Date.now();
  const windowMs = 60_000;
  const globalMax = parsePositiveInt(process.env.INTERNAL_SMOKE_RATE_LIMIT_PER_MIN, 30);
  const phoneMax = parsePositiveInt(process.env.INTERNAL_SMOKE_RATE_LIMIT_PER_PHONE_PER_MIN, 12);

  const nextGlobal = bumpWindow(globalWindow, now, windowMs);
  globalWindow.start = nextGlobal.start;
  globalWindow.count = nextGlobal.count;
  if (globalWindow.count > globalMax) {
    return { ok: false, scope: 'global', limit: globalMax };
  }

  if (phone10) {
    const prev = phoneWindows.get(phone10);
    const nextPhone = bumpWindow(prev, now, windowMs);
    phoneWindows.set(phone10, nextPhone);
    if (nextPhone.count > phoneMax) {
      return { ok: false, scope: 'phone', limit: phoneMax };
    }
  }

  return { ok: true };
}

/**
 * Production-only gate for /api/internal/smoke/*.
 * Rejects when secret missing, NODE_ENV≠production, or credential invalid.
 */
function requireInternalSmoke(req, res, next) {
  const path = req.originalUrl || req.path;
  const phoneHint =
    (req.body && (req.body.phone || req.body.mobile)) ||
    (req.query && (req.query.phone || req.query.mobile)) ||
    '';
  const phone10 = String(phoneHint || '')
    .replace(/\D/g, '')
    .slice(-10);

  if (!isProductionEnv()) {
    console.warn(
      JSON.stringify({
        event: 'internal_smoke_rejected',
        reason: 'not_production',
        path,
        phone_tail: phone10.length === 10 ? maskPhoneTail(phone10) : null,
      })
    );
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  if (!getInternalSmokeSecret()) {
    console.error(
      JSON.stringify({
        event: 'internal_smoke_rejected',
        reason: 'secret_not_configured',
        path,
      })
    );
    return res.status(503).json({ success: false, message: 'Smoke endpoint disabled' });
  }

  const provided = extractInternalSmokeCredential(req);
  if (!isValidInternalSmokeSecret(provided)) {
    console.warn(
      JSON.stringify({
        event: 'internal_smoke_auth_failed',
        path,
        phone_tail: phone10.length === 10 ? maskPhoneTail(phone10) : null,
        mode: provided ? 'provided' : 'none',
      })
    );
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const rate = checkRateLimit(phone10.length === 10 ? phone10 : null);
  if (!rate.ok) {
    console.warn(
      JSON.stringify({
        event: 'internal_smoke_rate_limited',
        path,
        scope: rate.scope,
        limit: rate.limit,
        phone_tail: phone10.length === 10 ? maskPhoneTail(phone10) : null,
      })
    );
    return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
  }

  console.log(
    JSON.stringify({
      event: 'internal_smoke_auth_ok',
      path,
      method: req.method,
      phone_tail: phone10.length === 10 ? maskPhoneTail(phone10) : null,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
  );

  next();
}

module.exports = {
  requireInternalSmoke,
  checkRateLimit,
};
