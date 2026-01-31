const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const { sendOtp: sendOtpSms } = require('../utils/msg91Service');
const MeetEntry = require('../models/MeetEntry');

// Separate OTP storage for meet registrations to avoid conflicts
const meetOtpStore = new Map();

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_EXPIRY_MS = OTP_EXPIRY_MINUTES * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;

function normalizePhone(phone) {
  return phone?.toString().replace(/\D/g, '').slice(-10);
}

// Rate limiting helper
const otpRateLimits = new Map();
function canSendOtp(mobile) {
  const now = Date.now();
  const lastSent = otpRateLimits.get(mobile);
  
  if (lastSent && (now - lastSent < 60000)) { // 1 minute cooldown
    return { allowed: false, retryAfter: Math.ceil((60000 - (now - lastSent)) / 1000) };
  }
  
  return { allowed: true };
}

// Send OTP for Meet registration
exports.sendOtp = async (req, res) => {
  try {
    const { name, email, mobile } = req.body || {};

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required (min 2 characters)' });
    }
    if (!email || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!mobile || typeof mobile !== 'string') {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    const m = normalizePhone(mobile);
    if (!/^\d{10}$/.test(m)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required' });
    }

    // Check rate limit
    const rateCheck = canSendOtp(m);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${rateCheck.retryAfter} seconds before requesting another OTP`,
        retryAfter: rateCheck.retryAfter
      });
    }

    // Check if mobile already registered
    const existingEntry = await MeetEntry.findOne({ mobile: m });
    if (existingEntry) {
      return res.status(400).json({ 
        success: false, 
        message: 'This mobile number is already registered for the meeting' 
      });
    }

    // Generate and send OTP
    const otp = generateOTP();
    const hashed = hashOTP(otp);
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    const gwResponse = await sendOtpSms(m, otp);
    if (!gwResponse.success) {
      return res.status(502).json({
        success: false,
        message: 'Could not send OTP. Please try again.',
        detail: gwResponse.error || 'SMS service error'
      });
    }

    // Store OTP with user details
    meetOtpStore.set(m, {
      otpHash: hashed,
      expiresAt,
      attempts: 0,
      name: name.trim(),
      email: email.trim().toLowerCase()
    });

    otpRateLimits.set(m, Date.now());

    return res.status(200).json({ 
      success: true, 
      message: 'OTP sent successfully to your mobile number' 
    });
  } catch (error) {
    console.error('[meetController.sendOtp] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

// Verify OTP and register for meet
exports.verifyOtpAndRegister = async (req, res) => {
  try {
    const { mobile, otp } = req.body || {};

    if (!mobile || typeof mobile !== 'string') {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    const m = normalizePhone(mobile);
    if (!/^\d{10}$/.test(m)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required' });
    }

    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(String(otp))) {
      return res.status(400).json({ success: false, message: 'OTP must be 6 digits' });
    }

    // Get stored OTP data
    const otpData = meetOtpStore.get(m);
    if (!otpData) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please request a new one.' });
    }

    // Check expiry
    if (Date.now() > otpData.expiresAt) {
      meetOtpStore.delete(m);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    // Check attempts
    if (otpData.attempts >= MAX_VERIFY_ATTEMPTS) {
      meetOtpStore.delete(m);
      return res.status(400).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    // Verify OTP
    if (!verifyOTP(String(otp), otpData.otpHash)) {
      otpData.attempts += 1;
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP. Please try again.',
        attemptsLeft: MAX_VERIFY_ATTEMPTS - otpData.attempts
      });
    }

    // OTP verified - Create meet entry
    const meetEntry = await MeetEntry.create({
      name: otpData.name,
      email: otpData.email,
      mobile: m,
      status: 'registered',
      registeredAt: new Date()
    });

    // Clear OTP data
    meetOtpStore.delete(m);

    // Get Meet link from environment
    const meetLink = process.env.GOOGLE_MEET_LINK || 'https://meet.google.com/';

    return res.status(200).json({ 
      success: true, 
      message: 'Registration successful! Redirecting to Google Meet...',
      data: {
        meetLink,
        entry: {
          name: meetEntry.name,
          email: meetEntry.email,
          mobile: meetEntry.mobile
        }
      }
    });
  } catch (error) {
    console.error('[meetController.verifyOtpAndRegister] Error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'This mobile number is already registered for the meeting' 
      });
    }
    
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

// Mark user as joined (called before redirect)
exports.markJoined = async (req, res) => {
  try {
    const { mobile } = req.params;

    if (!mobile || typeof mobile !== 'string') {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    const m = normalizePhone(mobile);
    if (!/^\d{10}$/.test(m)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required' });
    }

    const meetEntry = await MeetEntry.findOneAndUpdate(
      { mobile: m },
      { 
        $set: { 
          status: 'joined', 
          joinedAt: new Date() 
        } 
      },
      { new: true }
    );

    if (!meetEntry) {
      return res.status(404).json({ success: false, message: 'Registration not found' });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Marked as joined successfully',
      data: meetEntry
    });
  } catch (error) {
    console.error('[meetController.markJoined] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};

// Admin: Get meet entries with filter and pagination
exports.getMeetEntries = async (req, res) => {
  try {
    const { filter = 'all', search = '', sortBy = 'registeredAt', sortOrder = 'desc', page = '1', limit = '50' } = req.query;

    let query = {};

    // Apply filter
    if (filter === 'registered') {
      query.status = 'registered';
    } else if (filter === 'joined') {
      query.status = 'joined';
    } else if (filter === 'not-joined') {
      query.status = 'registered'; // Same as registered (those who haven't joined yet)
    }

    // Apply search
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { mobile: searchRegex }
      ];
    }

    // Sort configuration
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [entries, totalCount] = await Promise.all([
      MeetEntry.find(query).sort(sort).skip(skip).limit(limitNum).lean(),
      MeetEntry.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      count: entries.length,
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      limit: limitNum,
      data: entries
    });
  } catch (error) {
    console.error('[meetController.getMeetEntries] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};

// Admin: Get statistics
exports.getMeetStats = async (req, res) => {
  try {
    const totalRegistered = await MeetEntry.countDocuments({});
    const totalJoined = await MeetEntry.countDocuments({ status: 'joined' });
    const notJoined = totalRegistered - totalJoined;
    const joinRate = totalRegistered > 0 ? ((totalJoined / totalRegistered) * 100).toFixed(1) : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalRegistered,
        totalJoined,
        notJoined,
        joinRate: parseFloat(joinRate)
      }
    });
  } catch (error) {
    console.error('[meetController.getMeetStats] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};

// Cleanup expired OTPs periodically (call this on server start)
function cleanupExpiredOtps() {
  const now = Date.now();
  for (const [mobile, data] of meetOtpStore.entries()) {
    if (now > data.expiresAt) {
      meetOtpStore.delete(mobile);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredOtps, 5 * 60 * 1000);

module.exports = exports;
