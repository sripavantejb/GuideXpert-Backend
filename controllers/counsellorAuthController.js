const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');
const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const { sendOtp: sendOtpSms } = require('../utils/msg91Service');
const counsellorOtpRepository = require('../utils/counsellorOtpRepository');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.COUNSELLOR_JWT_EXPIRES_IN || '24h';
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_EXPIRY_MS = OTP_EXPIRY_MINUTES * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;

function toUser(counsellor) {
  return {
    id: counsellor._id,
    name: counsellor.name,
    email: counsellor.email,
    phone: counsellor.phone || undefined,
    role: counsellor.role,
  };
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'password is required' });
    }
    if (!JWT_SECRET) {
      console.error('[Counsellor] COUNSELLOR_JWT_SECRET not set');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    const counsellor = await Counsellor.findOne({ email: email.trim().toLowerCase() });
    if (!counsellor) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const valid = await counsellor.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { counsellorId: counsellor._id.toString() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.status(200).json({
      success: true,
      token,
      user: toUser(counsellor),
    });
  } catch (error) {
    console.error('[Counsellor login]', error);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : error.message,
    });
  }
};

exports.sendOtp = async (req, res) => {
  try {
    const phone = req.body?.phone;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = counsellorOtpRepository.normalize(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const canSend = await counsellorOtpRepository.canSend(p);
    if (!canSend.allowed) {
      return res.status(429).json({
        success: false,
        message: canSend.message || 'Too many OTP requests. Try again later.',
        retryAfter: canSend.retryAfter,
      });
    }

    const otp = generateOTP();
    const hashed = hashOTP(otp);
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    const gw = await sendOtpSms(p, otp);
    if (!gw.success) {
      return res.status(502).json({
        success: false,
        message: 'Could not send OTP.',
        detail: gw.error || 'SMS service error',
      });
    }

    await counsellorOtpRepository.saveOtp(p, hashed, expiresAt);
    return res.status(200).json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('[Counsellor sendOtp]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body || {};
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = counsellorOtpRepository.normalize(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(String(otp))) {
      return res.status(400).json({ success: false, message: 'OTP must be 6 digits' });
    }
    if (!JWT_SECRET) {
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    const rec = await counsellorOtpRepository.getLatest(p);
    if (!rec) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    if (new Date(rec.expiresAt) < new Date()) {
      await counsellorOtpRepository.deleteOtp(p);
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
      await counsellorOtpRepository.deleteOtp(p);
      return res.status(400).json({ success: false, message: 'Too many attempts.' });
    }
    if (!verifyOTP(String(otp), rec.otpHash)) {
      const updated = await counsellorOtpRepository.incrementAttempts(p);
      if (updated && updated.attempts >= MAX_VERIFY_ATTEMPTS) {
        await counsellorOtpRepository.deleteOtp(p);
      }
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    await counsellorOtpRepository.deleteOtp(p);

    const counsellor = await Counsellor.findOne({ phone: p });
    if (!counsellor) {
      return res.status(401).json({ success: false, message: 'No counsellor registered with this number.' });
    }

    const token = jwt.sign(
      { counsellorId: counsellor._id.toString() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.status(200).json({
      success: true,
      token,
      user: toUser(counsellor),
    });
  } catch (err) {
    console.error('[Counsellor verifyOtp]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
