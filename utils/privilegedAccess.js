/**
 * Privileged phone bypass for QA: fixed OTP (no SMS) and full panel eligibility.
 * New phone-gated features should call isPrivilegedPhone() before DB eligibility checks.
 */

const crypto = require('crypto');
const otpRepository = require('./otpRepository');
const Admin = require('../models/Admin');

const DEFAULT_PRIVILEGED_PHONE = '8143266699';
const DEFAULT_PRIVILEGED_OTP = '123456';

function normalizePrivilegedPhone(phone) {
  return otpRepository.normalize(phone);
}

function getPrivilegedPhone() {
  const raw = process.env.OTP_BYPASS_PHONE || DEFAULT_PRIVILEGED_PHONE;
  const p = normalizePrivilegedPhone(raw);
  return /^\d{10}$/.test(p) ? p : DEFAULT_PRIVILEGED_PHONE;
}

function getPrivilegedOtp() {
  const code = String(process.env.OTP_BYPASS_CODE || DEFAULT_PRIVILEGED_OTP).trim();
  return /^\d{6}$/.test(code) ? code : DEFAULT_PRIVILEGED_OTP;
}

function isPrivilegedPhone(phone) {
  const p = normalizePrivilegedPhone(phone);
  if (!p || p.length !== 10) return false;
  return p === getPrivilegedPhone();
}

/**
 * Find or create super-admin for privileged phone (username = 10-digit phone).
 */
async function ensurePrivilegedAdmin(phone) {
  const p = normalizePrivilegedPhone(phone);
  if (!isPrivilegedPhone(p)) {
    throw new Error('Not a privileged phone');
  }
  const username = p;
  let admin = await Admin.findOne({ username });
  const password =
    (process.env.PRIVILEGED_ADMIN_PASSWORD && String(process.env.PRIVILEGED_ADMIN_PASSWORD).trim()) ||
    crypto.randomBytes(16).toString('hex');
  if (!admin) {
    admin = await Admin.create({
      username,
      password,
      name: 'Privileged QA Admin',
      isSuperAdmin: true,
      sectionAccess: [],
    });
    console.log('[privilegedAccess] Created super-admin for phone ending', p.slice(-4));
    return admin;
  }
  if (!admin.isSuperAdmin) {
    admin.isSuperAdmin = true;
    admin.updatedAt = new Date();
    await admin.save();
  }
  return admin;
}

module.exports = {
  normalizePrivilegedPhone,
  getPrivilegedPhone,
  getPrivilegedOtp,
  isPrivilegedPhone,
  ensurePrivilegedAdmin,
};
