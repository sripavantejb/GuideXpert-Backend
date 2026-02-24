const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');
const otpStore = require('../utils/otpStore');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.COUNSELLOR_JWT_EXPIRES_IN || '24h';

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
      user: {
        id: counsellor._id,
        name: counsellor.name,
        email: counsellor.email,
        role: counsellor.role,
      },
    });
  } catch (error) {
    console.error('[Counsellor login]', error);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : error.message,
    });
  }
};

exports.loginWithPhone = async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    if (!JWT_SECRET) {
      console.error('[Counsellor] COUNSELLOR_JWT_SECRET not set');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    const normalized = otpStore.normalize(phone);
    if (normalized.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit phone required' });
    }

    if (!otpStore.isVerified(normalized)) {
      return res.status(401).json({ success: false, message: 'Verify OTP first' });
    }

    const counsellor = await Counsellor.findOne({ phone: normalized });
    if (!counsellor) {
      return res.status(401).json({ success: false, message: 'No counsellor account linked to this number' });
    }

    otpStore.removeVerified(normalized);

    const token = jwt.sign(
      { counsellorId: counsellor._id.toString() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: counsellor._id,
        name: counsellor.name,
        email: counsellor.email,
        role: counsellor.role,
      },
    });
  } catch (error) {
    console.error('[Counsellor loginWithPhone]', error);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : error.message,
    });
  }
};
