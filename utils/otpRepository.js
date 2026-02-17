/**
 * MongoDB-backed OTP storage with resend cooldown and rate limiting.
 * Keys use normalized 10-digit Indian phone (no 91 prefix).
 */

const OtpVerification = require('../models/OtpVerification');

const RESEND_COOLDOWN_MS = 60 * 1000;       // 60 seconds
const RATE_WINDOW_MS = 15 * 60 * 1000;     // 15 minutes
const MAX_OTP_PER_WINDOW = 3;

function normalize(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * Check if we can send a new OTP: resend cooldown (60s) and rate limit (3 per 15 min).
 * @returns {{ allowed: boolean, retryAfter?: number, message?: string }}
 */
async function canSend(phone) {
  const p = normalize(phone);
  if (!p || p.length !== 10) return { allowed: false, message: 'Invalid phone' };

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - RESEND_COOLDOWN_MS);
  const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);

  // Resend cooldown: latest OTP for this phone must be older than 60s
  const latest = await OtpVerification.findOne({ phoneNumber: p })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  if (latest && latest.createdAt && new Date(latest.createdAt) > cooldownCutoff) {
    const waitSec = Math.ceil((new Date(latest.createdAt).getTime() + RESEND_COOLDOWN_MS - now.getTime()) / 1000);
    return { allowed: false, retryAfter: waitSec, message: 'Please wait before requesting another OTP.' };
  }

  // Rate limit: count OTPs for this phone in last 15 min
  const count = await OtpVerification.countDocuments({
    phoneNumber: p,
    createdAt: { $gte: windowStart }
  });
  if (count >= MAX_OTP_PER_WINDOW) {
    return { allowed: false, message: 'Too many OTP requests. Try again after 15 minutes.', retryAfter: 900 };
  }

  return { allowed: true };
}

/**
 * Save OTP (hashed) for a phone. Overwrites any existing OTP for that phone.
 */
async function saveOtp(phone, otpHash, expiresAt) {
  const p = normalize(phone);
  await OtpVerification.deleteMany({ phoneNumber: p });
  await OtpVerification.create({
    phoneNumber: p,
    otpHash,
    expiresAt: new Date(expiresAt),
    attempts: 0
  });
}

/**
 * Get latest OTP record for a phone (or null).
 */
async function getLatest(phone) {
  const p = normalize(phone);
  return OtpVerification.findOne({ phoneNumber: p })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
}

/**
 * Delete OTP record(s) for a phone.
 */
async function deleteOtp(phone) {
  const p = normalize(phone);
  await OtpVerification.deleteMany({ phoneNumber: p });
}

/**
 * Increment verification attempts for the latest OTP of this phone.
 * @returns {Promise<{ attempts: number } | null>}
 */
async function incrementAttempts(phone) {
  const p = normalize(phone);
  const doc = await OtpVerification.findOneAndUpdate(
    { phoneNumber: p },
    { $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: -1 } } // update latest
  ).lean().exec();
  return doc ? { attempts: doc.attempts } : null;
}

module.exports = {
  normalize,
  canSend,
  saveOtp,
  getLatest,
  deleteOtp,
  incrementAttempts
};
