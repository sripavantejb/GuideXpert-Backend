/**
 * In-memory OTP store with expiry and rate limiting.
 * Keys use normalized 10-digit Indian phone (no 91 prefix).
 */

const OTPS = new Map();       // phone -> { hashedOtp, expiresAt }
const RATE_LIMIT = new Map(); // phone -> { count, windowStart }
const VERIFIED = new Map();   // phone -> verifiedAt
const RATE_WINDOW_MS = 15 * 60 * 1000;  // 15 minutes
const MAX_OTP_PER_WINDOW = 3;
const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min to submit after verify

function normalize(phone) {
  const d = String(phone).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

function purgeExpired() {
  const now = Date.now();
  for (const [p, v] of OTPS.entries()) if (v.expiresAt < now) OTPS.delete(p);
  for (const [p, v] of RATE_LIMIT.entries()) if (now - v.windowStart > RATE_WINDOW_MS) RATE_LIMIT.delete(p);
  for (const [p, t] of VERIFIED.entries()) if (now - t > VERIFIED_TTL_MS) VERIFIED.delete(p);
}

function set(phone, hashedOtp, expiresAt) {
  purgeExpired();
  const p = normalize(phone);
  OTPS.set(p, { hashedOtp, expiresAt });
}

function get(phone) {
  purgeExpired();
  return OTPS.get(normalize(phone)) || null;
}

function remove(phone) {
  OTPS.delete(normalize(phone));
}

function checkRateLimit(phone) {
  purgeExpired();
  const p = normalize(phone);
  const v = RATE_LIMIT.get(p);
  if (!v) return { allowed: true };
  if (Date.now() - v.windowStart > RATE_WINDOW_MS) {
    RATE_LIMIT.delete(p);
    return { allowed: true };
  }
  if (v.count >= MAX_OTP_PER_WINDOW) {
    const retryAfter = Math.ceil((v.windowStart + RATE_WINDOW_MS - Date.now()) / 1000);
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

function incrementRateLimit(phone) {
  purgeExpired();
  const p = normalize(phone);
  const v = RATE_LIMIT.get(p);
  const now = Date.now();
  if (!v || now - v.windowStart > RATE_WINDOW_MS)
    RATE_LIMIT.set(p, { count: 1, windowStart: now });
  else
    v.count += 1;
}

function addVerified(phone) {
  VERIFIED.set(normalize(phone), Date.now());
}

function isVerified(phone) {
  purgeExpired();
  return VERIFIED.has(normalize(phone));
}

function removeVerified(phone) {
  VERIFIED.delete(normalize(phone));
}

module.exports = {
  set,
  get,
  remove,
  checkRateLimit,
  incrementRateLimit,
  addVerified,
  isVerified,
  removeVerified,
  normalize
};
