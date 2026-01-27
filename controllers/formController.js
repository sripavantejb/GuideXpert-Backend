const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const otpStore = require('../utils/otpStore');
const { sendWhatsAppOTP } = require('../utils/gupshupService');
const { getDemoSlots } = require('../utils/demoSlots');
const FormSubmission = require('../models/FormSubmission');

const OTP_EXPIRY_MS = 5 * 60 * 1000;

function normalizePhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

exports.sendOtp = async (req, res) => {
  try {
    const { fullName, occupation } = req.body || {};
    const phone = req.body?.phone || req.body?.whatsappNumber;

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'fullName is required' });
    }
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }
    if (!occupation || typeof occupation !== 'string' || !occupation.trim()) {
      return res.status(400).json({ success: false, message: 'occupation is required' });
    }

    const rl = otpStore.checkRateLimit(p);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Try again after 15 minutes.',
        retryAfter: rl.retryAfter
      });
    }

    const otp = generateOTP();
    const hashed = hashOTP(otp);
    otpStore.set(p, hashed, Date.now() + OTP_EXPIRY_MS);
    otpStore.incrementRateLimit(p);

    const gw = await sendWhatsAppOTP(p, otp);
    if (!gw.success) {
      return res.status(400).json({
        success: false,
        message: 'Could not send OTP to WhatsApp.',
        detail: gw.error || 'WhatsApp service error'
      });
    }

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body || {};
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(String(otp))) {
      return res.status(400).json({ success: false, message: 'OTP must be 6 digits' });
    }

    const rec = otpStore.get(p);
    if (!rec || rec.expiresAt < Date.now()) {
      otpStore.remove(p);
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    if (!verifyOTP(String(otp), rec.hashedOtp)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    otpStore.remove(p);
    otpStore.addVerified(p);

    return res.status(200).json({ verified: true });
  } catch {
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getDemoSlots = (req, res) => {
  try {
    return res.status(200).json(getDemoSlots());
  } catch {
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.submitApplication = async (req, res) => {
  try {
    const { fullName, occupation, demoInterest, selectedSlot } = req.body || {};
    const phone = req.body?.phone || req.body?.whatsappNumber;

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'fullName is required' });
    }
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }
    if (!occupation || typeof occupation !== 'string' || !occupation.trim()) {
      return res.status(400).json({ success: false, message: 'occupation is required' });
    }
    if (!demoInterest || !['YES_SOON', 'MAYBE_LATER'].includes(demoInterest)) {
      return res.status(400).json({ success: false, message: 'demoInterest must be YES_SOON or MAYBE_LATER' });
    }
    if (demoInterest === 'YES_SOON' && !['SATURDAY_7PM', 'SUNDAY_3PM'].includes(selectedSlot)) {
      return res.status(400).json({ success: false, message: 'selectedSlot is required when demoInterest is YES_SOON' });
    }

    if (!otpStore.isVerified(p)) {
      return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
    }

    const doc = {
      fullName: fullName.trim(),
      phone: p,
      occupation: occupation.trim(),
      demoInterest
    };
    if (demoInterest === 'YES_SOON') doc.selectedSlot = selectedSlot;

    await FormSubmission.create(doc);
    otpStore.removeVerified(p);

    return res.status(201).json({ success: true, message: 'Application submitted successfully.' });
  } catch {
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
