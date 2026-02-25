const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');
const otpStore = require('../utils/otpStore');
const VerifiedPhoneSession = require('../models/VerifiedPhoneSession');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.COUNSELLOR_JWT_EXPIRES_IN || '24h';

/** 15 min window to use verified phone (matches VerifiedPhoneSession TTL) */
const VERIFIED_PHONE_WINDOW_MS = 15 * 60 * 1000;

async function isPhoneVerifiedInDb(phone) {
  const since = new Date(Date.now() - VERIFIED_PHONE_WINDOW_MS);
  const doc = await VerifiedPhoneSession.findOne({ phone, verifiedAt: { $gte: since } }).lean();
  return !!doc;
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
      return res.status(500).json({ success: false, message: 'Counsellor login is not configured. Please contact support.' });
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
      console.error('[Counsellor] COUNSELLOR_JWT_SECRET not set — set it in .env / Vercel env vars');
      return res.status(500).json({ success: false, message: 'Counsellor login is not configured. Please contact support.' });
    }

    const normalized = otpStore.normalize(phone);
    if (normalized.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit phone required' });
    }

    const verifiedInMemory = otpStore.isVerified(normalized);
    let verifiedInDb = false;
    try {
      verifiedInDb = await isPhoneVerifiedInDb(normalized);
    } catch (dbErr) {
      console.error('[Counsellor loginWithPhone] isPhoneVerifiedInDb failed:', dbErr.message);
    }
    if (!verifiedInMemory && !verifiedInDb) {
      return res.status(401).json({ success: false, message: 'Verify OTP first' });
    }

    let counsellor;
    try {
      counsellor = await Counsellor.findOne({ phone: normalized });
      if (!counsellor) {
        const defaultName = process.env.COUNSELLOR_DEFAULT_NAME || 'Counsellor';
        const placeholderEmail = `counsellor-${normalized}@guidexpert.phone`;
        const randomPassword = crypto.randomBytes(12).toString('hex');
        try {
          counsellor = await Counsellor.create({
            phone: normalized,
            name: defaultName,
            email: placeholderEmail,
            password: randomPassword,
            role: 'counsellor',
          });
        } catch (err) {
          if (err.code === 11000) {
            try {
              counsellor = await Counsellor.findOne({ phone: normalized });
            } catch (findErr) {
              console.error('[Counsellor loginWithPhone] findOne after 11000 failed:', findErr.message);
            }
          }
          if (!counsellor) {
            try {
              counsellor = await Counsellor.findOne({ phone: normalized });
            } catch (_) {}
          }
          if (!counsellor) throw err;
        }
      }
    } catch (counsellorErr) {
      console.error('[Counsellor loginWithPhone] Counsellor lookup/create failed:', counsellorErr.message, counsellorErr.stack);
      try {
        counsellor = await Counsellor.findOne({ phone: normalized });
      } catch (retryErr) {
        console.error('[Counsellor loginWithPhone] Retry findOne failed:', retryErr.message);
      }
      if (counsellor) {
        // Proceed with login
      } else {
        return res.status(500).json({
          success: false,
          message: 'Login failed. Please try again or contact support.',
        });
      }
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
    console.error('[Counsellor loginWithPhone]', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.',
    });
  }
};
