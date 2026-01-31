const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const { sendOtp: sendOtpSms } = require('../utils/msg91Service');
const MeetEntry = require('../models/MeetEntry');
const OtpVerification = require('../models/OtpVerification');

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_EXPIRY_MS = OTP_EXPIRY_MINUTES * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;

function normalizePhone(phone) {
  return phone?.toString().replace(/\D/g, '').slice(-10);
}

// Rate limiting helper (using database)
async function canSendOtp(mobile) {
  const oneMinuteAgo = new Date(Date.now() - 60000);
  const recentOtp = await OtpVerification.findOne({
    phoneNumber: mobile,
    createdAt: { $gte: oneMinuteAgo }
  }).sort({ createdAt: -1 }).lean();
  
  if (recentOtp) {
    const elapsed = Date.now() - recentOtp.createdAt.getTime();
    const retryAfter = Math.ceil((60000 - elapsed) / 1000);
    return { allowed: false, retryAfter };
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
    const rateCheck = await canSendOtp(m);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${rateCheck.retryAfter} seconds before requesting another OTP`,
        retryAfter: rateCheck.retryAfter
      });
    }

    // Check if mobile already registered (status: registered or joined)
    const existingEntry = await MeetEntry.findOne({ 
      mobile: m,
      status: { $in: ['registered', 'joined'] }
    });
    if (existingEntry) {
      return res.status(400).json({ 
        success: false, 
        message: 'This mobile number is already registered for the meeting' 
      });
    }

    // Generate and send OTP
    const otp = generateOTP();
    const hashed = hashOTP(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    const gwResponse = await sendOtpSms(m, otp);
    if (!gwResponse.success) {
      return res.status(502).json({
        success: false,
        message: 'Could not send OTP. Please try again.',
        detail: gwResponse.error || 'SMS service error'
      });
    }

    // Delete any existing OTP for this phone number
    await OtpVerification.deleteMany({ phoneNumber: m });

    // Store OTP with user details in database
    await OtpVerification.create({
      phoneNumber: m,
      otpHash: hashed,
      expiresAt,
      attempts: 0,
      name: name.trim(),
      email: email.trim().toLowerCase()
    });

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

    // Get stored OTP data from database
    const otpData = await OtpVerification.findOne({ phoneNumber: m });
    if (!otpData) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please request a new one.' });
    }

    // Validate that required fields exist before proceeding
    if (!otpData.name || !otpData.email) {
      console.error('[meetController.verifyOtpAndRegister] Invalid OTP data - missing name or email:', { 
        phoneNumber: m, 
        hasName: !!otpData.name, 
        hasEmail: !!otpData.email 
      });
      await OtpVerification.deleteOne({ phoneNumber: m });
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid registration data. Please request a new OTP.' 
      });
    }

    // Check expiry
    if (Date.now() > otpData.expiresAt.getTime()) {
      await OtpVerification.deleteOne({ phoneNumber: m });
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    // Check attempts
    if (otpData.attempts >= MAX_VERIFY_ATTEMPTS) {
      await OtpVerification.deleteOne({ phoneNumber: m });
      return res.status(400).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    // Verify OTP
    if (!verifyOTP(String(otp), otpData.otpHash)) {
      otpData.attempts += 1;
      await otpData.save();
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP. Please try again.',
        attemptsLeft: MAX_VERIFY_ATTEMPTS - otpData.attempts
      });
    }

    // Sanitize name/email (ensure strings, trim) to avoid validation errors
    const name = String(otpData.name || '').trim();
    const email = String(otpData.email || '').trim().toLowerCase();
    if (!name || name.length < 2 || !email || !/^\S+@\S+\.\S+$/.test(email)) {
      await OtpVerification.deleteOne({ phoneNumber: m });
      return res.status(400).json({
        success: false,
        message: 'Invalid registration data. Please request a new OTP.'
      });
    }

    // OTP verified - Create meet entry
    const meetEntry = await MeetEntry.create({
      name,
      email,
      mobile: m,
      status: 'registered',
      registeredAt: new Date()
    });

    // Clear OTP data from database
    await OtpVerification.deleteOne({ phoneNumber: m });

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
    
    // Handle duplicate key error (mobile already registered)
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'This mobile number is already registered for the meeting' 
      });
    }

    // Handle Mongoose validation error (e.g. invalid name/email) - clear bad OTP and ask for new one
    if (error.name === 'ValidationError') {
      const m = normalizePhone(req.body?.mobile);
      if (m && /^\d{10}$/.test(m)) {
        await OtpVerification.deleteOne({ phoneNumber: m }).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: 'Invalid registration data. Please request a new OTP.'
      });
    }
    
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

// Clean up registration data for a mobile number (for debugging/testing)
exports.cleanupMobile = async (req, res) => {
  try {
    const { mobile } = req.body || {};

    if (!mobile || typeof mobile !== 'string') {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    const m = normalizePhone(mobile);
    if (!/^\d{10}$/.test(m)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required' });
    }

    // Delete OTP verification records
    const otpDeleted = await OtpVerification.deleteMany({ phoneNumber: m });
    
    // Delete meet entry records
    const meetDeleted = await MeetEntry.deleteMany({ mobile: m });

    console.log('[meetController.cleanupMobile] Cleaned up data:', { 
      mobile: m, 
      otpRecords: otpDeleted.deletedCount, 
      meetRecords: meetDeleted.deletedCount 
    });

    return res.status(200).json({ 
      success: true, 
      message: `Cleanup complete. Deleted ${otpDeleted.deletedCount} OTP record(s) and ${meetDeleted.deletedCount} meet entry record(s).`,
      data: {
        otpRecordsDeleted: otpDeleted.deletedCount,
        meetRecordsDeleted: meetDeleted.deletedCount
      }
    });
  } catch (error) {
    console.error('[meetController.cleanupMobile] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cleanup data. Please try again.' });
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

// Note: MongoDB automatically cleans up expired OTPs using TTL index on expiresAt field

module.exports = exports;
