/**
 * In-process OTP fallback when MongoDB write fails (e.g. transient serverless errors).
 * Same phone key as otpRepository (10-digit). Not shared across serverless instances.
 */

const STORE = new Map();

function normalize(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

function set(phone, record) {
  const p = normalize(phone);
  if (!p) return;
  STORE.set(p, {
    phoneNumber: p,
    otpHash: record.otpHash,
    expiresAt: record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt),
    attempts: record.attempts ?? 0,
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt || Date.now()),
  });
}

function get(phone) {
  const p = normalize(phone);
  const rec = STORE.get(p);
  if (!rec) return null;
  if (new Date(rec.expiresAt) < new Date()) {
    STORE.delete(p);
    return null;
  }
  return { ...rec };
}

function remove(phone) {
  STORE.delete(normalize(phone));
}

function incrementAttempts(phone) {
  const p = normalize(phone);
  const rec = STORE.get(p);
  if (!rec) return null;
  rec.attempts = (rec.attempts || 0) + 1;
  STORE.set(p, rec);
  return { attempts: rec.attempts };
}

module.exports = {
  set,
  get,
  remove,
  incrementAttempts,
};
