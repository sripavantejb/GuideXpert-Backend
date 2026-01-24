const crypto = require('crypto');

const OTP_SECRET = process.env.OTP_SECRET;
const OTP_LENGTH = 6;

/**
 * Generate a random 6-digit OTP
 */
function generateOTP() {
  return String(Math.floor(Math.pow(10, OTP_LENGTH - 1) + Math.random() * 9 * Math.pow(10, OTP_LENGTH - 1)));
}

/**
 * Hash OTP using HMAC-SHA256 with OTP_SECRET
 * @param {string} otp - Plain text OTP
 * @returns {string} Hex-encoded hash
 */
function hashOTP(otp) {
  if (!OTP_SECRET) {
    throw new Error('OTP_SECRET is not set');
  }
  return crypto.createHmac('sha256', OTP_SECRET).update(otp).digest('hex');
}

/**
 * Verify plain OTP against stored hash
 * @param {string} plainOtp - User-provided OTP
 * @param {string} hashedOtp - Stored hash
 * @returns {boolean}
 */
function verifyOTP(plainOtp, hashedOtp) {
  if (!plainOtp || !hashedOtp) return false;
  try {
    if (!OTP_SECRET) return false;
    const a = Buffer.from(hashOTP(plainOtp), 'hex');
    const b = Buffer.from(hashedOtp, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = {
  generateOTP,
  hashOTP,
  verifyOTP,
  OTP_LENGTH
};
