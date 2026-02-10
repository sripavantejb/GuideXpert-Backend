/**
 * MongoDB-backed OTP storage for counsellor login. Same resend/rate-limit logic as otpRepository.
 * Keys: normalized 10-digit Indian phone (no 91 prefix).
 */

const CounsellorOtp = require('../models/CounsellorOtp');

const RESEND_COOLDOWN_MS = 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_PER_WINDOW = 3;

function normalize(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

async function canSend(phone) {
  const p = normalize(phone);
  if (!p || p.length !== 10) return { allowed: false, message: 'Invalid phone' };

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - RESEND_COOLDOWN_MS);
  const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);

  const latest = await CounsellorOtp.findOne({ phoneNumber: p })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  if (latest && latest.createdAt && new Date(latest.createdAt) > cooldownCutoff) {
    const waitSec = Math.ceil((new Date(latest.createdAt).getTime() + RESEND_COOLDOWN_MS - now.getTime()) / 1000);
    return { allowed: false, retryAfter: waitSec, message: 'Please wait before requesting another OTP.' };
  }

  const count = await CounsellorOtp.countDocuments({
    phoneNumber: p,
    createdAt: { $gte: windowStart },
  });
  if (count >= MAX_OTP_PER_WINDOW) {
    return { allowed: false, message: 'Too many OTP requests. Try again after 15 minutes.', retryAfter: 900 };
  }

  return { allowed: true };
}

async function saveOtp(phone, otpHash, expiresAt) {
  const p = normalize(phone);
  await CounsellorOtp.deleteMany({ phoneNumber: p });
  await CounsellorOtp.create({
    phoneNumber: p,
    otpHash,
    expiresAt: new Date(expiresAt),
    attempts: 0,
  });
}

async function getLatest(phone) {
  const p = normalize(phone);
  return CounsellorOtp.findOne({ phoneNumber: p })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
}

async function deleteOtp(phone) {
  const p = normalize(phone);
  await CounsellorOtp.deleteMany({ phoneNumber: p });
}

async function incrementAttempts(phone) {
  const p = normalize(phone);
  const doc = await CounsellorOtp.findOneAndUpdate(
    { phoneNumber: p },
    { $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: -1 } }
  )
    .lean()
    .exec();
  return doc ? { attempts: doc.attempts } : null;
}

module.exports = {
  normalize,
  canSend,
  saveOtp,
  getLatest,
  deleteOtp,
  incrementAttempts,
};
