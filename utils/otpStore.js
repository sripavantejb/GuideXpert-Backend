/**
 * In-memory verified-phone cache only.
 * OTP storage and rate limiting are in otpRepository (MongoDB).
 * Keys use normalized 10-digit Indian phone (no 91 prefix).
 */

const VERIFIED = new Map();   // phone -> verifiedAt
const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min to submit after verify

function normalize(phone) {
  const d = String(phone).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

function purgeExpiredVerified() {
  const now = Date.now();
  for (const [p, t] of VERIFIED.entries()) {
    if (now - t > VERIFIED_TTL_MS) VERIFIED.delete(p);
  }
}

function addVerified(phone) {
  purgeExpiredVerified();
  VERIFIED.set(normalize(phone), Date.now());
}

function isVerified(phone) {
  purgeExpiredVerified();
  return VERIFIED.has(normalize(phone));
}

function removeVerified(phone) {
  VERIFIED.delete(normalize(phone));
}

module.exports = {
  addVerified,
  isVerified,
  removeVerified,
  normalize
};
