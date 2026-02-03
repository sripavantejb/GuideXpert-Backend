const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const otpStore = require('../utils/otpStore');
const otpRepository = require('../utils/otpRepository');
const { sendOtp: sendOtpSms, sendSlotConfirmationSms, sendReminderSms, sendMeetLinkSms, sendReminder30MinSms } = require('../utils/msg91Service');
const { getDemoSlots } = require('../utils/demoSlots');
const { appendFormSubmission } = require('../utils/sheetsService');
const FormSubmission = require('../models/FormSubmission');
const SlotConfig = require('../models/SlotConfig');
const { appendRow, updateRow, markRowDeleted } = require('../utils/googleSheetsService');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Sheet1';

const VALID_SLOT_ID_REGEX = /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)_(7PM|11AM|3PM)$/;
function isValidSlotId(slot) {
  return typeof slot === 'string' && VALID_SLOT_ID_REGEX.test(slot);
}

/**
 * Format slot date for SMS (e.g., "Saturday, 15th Feb")
 */
function formatSlotDateForSms(date) {
  const d = new Date(date);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const dayName = days[d.getDay()];
  const day = d.getDate();
  const month = months[d.getMonth()];
  
  // Add ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st' 
               : (day === 2 || day === 22) ? 'nd' 
               : (day === 3 || day === 23) ? 'rd' 
               : 'th';
  
  return `${dayName}, ${day}${suffix} ${month}`;
}

/**
 * Format slot time from slot ID for SMS (e.g., "7:00 PM", "11:00 AM")
 */
function formatSlotTimeForSms(slotId) {
  if (!slotId || typeof slotId !== 'string') return '';
  
  const timeMap = {
    '7PM': '7:00 PM',
    '11AM': '11:00 AM',
    '3PM': '3:00 PM'
  };
  
  // Extract time part from slot ID (e.g., "FRIDAY_7PM" -> "7PM")
  const parts = slotId.split('_');
  const timePart = parts[parts.length - 1];
  
  return timeMap[timePart] || timePart;
}

async function appendToSheetIfConfigured(submission) {
  if (!GOOGLE_SHEET_ID || !submission) {
    if (!GOOGLE_SHEET_ID) {
      console.warn('[Sheets] Append skipped: GOOGLE_SHEET_ID not set in .env');
    }
    return;
  }
  try {
    const result = await appendFormSubmission(GOOGLE_SHEET_ID, submission, GOOGLE_SHEET_RANGE);
    if (result.success) {
      console.log('[Sheets] Row appended to Google Sheet successfully');
    } else {
      console.error('[Sheets] Append failed (best-effort):', result.error);
    }
  } catch (err) {
    console.error('[Sheets] Append error (best-effort):', err.message);
  }
}

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_EXPIRY_MS = OTP_EXPIRY_MINUTES * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;

function normalizePhone(phone) {
  return otpRepository.normalize(phone);
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

    const canSend = await otpRepository.canSend(p);
    if (!canSend.allowed) {
      return res.status(429).json({
        success: false,
        message: canSend.message || 'Too many OTP requests. Try again later.',
        retryAfter: canSend.retryAfter
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
        detail: gw.error || 'SMS service error'
      });
    }

    await otpRepository.saveOtp(p, hashed, expiresAt);
    return res.status(200).json({ success: true, message: 'OTP sent successfully' });
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

    const rec = await otpRepository.getLatest(p);
    if (!rec) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    if (new Date(rec.expiresAt) < new Date()) {
      await otpRepository.deleteOtp(p);
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
      await otpRepository.deleteOtp(p);
      return res.status(400).json({ success: false, message: 'Too many attempts.' });
    }
    if (!verifyOTP(String(otp), rec.otpHash)) {
      const updated = await otpRepository.incrementAttempts(p);
      if (updated && updated.attempts >= MAX_VERIFY_ATTEMPTS) {
        await otpRepository.deleteOtp(p);
      }
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    await otpRepository.deleteOtp(p);
    otpStore.addVerified(p);

    return res.status(200).json({ success: true, message: 'OTP verified', verified: true });
  } catch (err) {
    console.error('[verifyOtp]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getDemoSlots = async (req, res) => {
  try {
    const result = await getDemoSlots();
    return res.status(200).json(result);
  } catch (err) {
    console.error('[getDemoSlots] Error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.saveStep1 = async (req, res) => {
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

    const step1Data = {
      fullName: fullName.trim(),
      whatsappNumber: p,
      occupation: occupation.trim(),
      step1CompletedAt: new Date()
    };

    console.log('[saveStep1] Attempting to save:', { phone: p, fullName: fullName.trim(), occupation: occupation.trim() });

    const result = await FormSubmission.findOneAndUpdate(
      { phone: p },
      {
        $set: {
          fullName: fullName.trim(),
          phone: p,
          occupation: occupation.trim(),
          step1Data,
          currentStep: 1,
          applicationStatus: 'in_progress',
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    console.log('[saveStep1] Save result:', {
      success: !!result,
      id: result?._id,
      phone: result?.phone,
      fullName: result?.fullName
    });

    // Verify the save by querying the database
    const verification = await FormSubmission.findOne({ phone: p });
    if (!verification) {
      console.error('[saveStep1] WARNING: Document not found after save!');
      return res.status(500).json({ success: false, message: 'Data was not saved. Please try again.' });
    }

    console.log('[saveStep1] Verification successful. Document ID:', verification._id);

    await appendToSheetIfConfigured(verification);

    return res.status(200).json({ success: true, message: 'Step 1 data saved successfully.' });
  } catch (error) {
    console.error('[saveStep1] Error:', error);
    console.error('[saveStep1] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
      errors: error.errors,
      stack: error.stack
    });
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      // Duplicate key error
      return res.status(400).json({ 
        success: false, 
        message: 'A submission with this phone number already exists.' 
      });
    }
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(e => e.message).join(', ');
      return res.status(400).json({ 
        success: false, 
        message: `Validation error: ${validationErrors}` 
      });
    }
    
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.saveStep2 = async (req, res) => {
  try {
    const { phone } = req.body || {};

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    if (!otpStore.isVerified(p)) {
      return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
    }

    const step2Data = {
      otpVerified: true,
      step2CompletedAt: new Date()
    };

    console.log('[saveStep2] Attempting to save:', { phone: p });

    const result = await FormSubmission.findOneAndUpdate(
      { phone: p },
      {
        $set: {
          step2Data,
          currentStep: 2,
          applicationStatus: 'in_progress',
          updatedAt: new Date()
        }
      },
      { upsert: false, new: true, runValidators: true }
    );

    if (!result) {
      console.error('[saveStep2] Document not found for phone:', p);
      return res.status(404).json({ success: false, message: 'Step 1 data not found. Please complete Step 1 first.' });
    }

    console.log('[saveStep2] Save successful. Document ID:', result._id);

    await appendToSheetIfConfigured(result);

    return res.status(200).json({ success: true, message: 'Step 2 data saved successfully.' });
  } catch (error) {
    console.error('[saveStep2] Error:', error);
    console.error('[saveStep2] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.saveStep3 = async (req, res) => {
  try {
    const { phone, selectedSlot, slotDate } = req.body || {};

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }
    if (!selectedSlot || !isValidSlotId(selectedSlot)) {
      return res.status(400).json({ success: false, message: 'selectedSlot must be a valid slot ID (e.g. FRIDAY_7PM, SUNDAY_11AM)' });
    }
    if (!slotDate || isNaN(new Date(slotDate).getTime())) {
      return res.status(400).json({ success: false, message: 'Valid slotDate is required' });
    }

    if (!otpStore.isVerified(p)) {
      return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
    }

    const slotConfig = await SlotConfig.findOne({ slotId: selectedSlot }).lean();
    if (slotConfig && slotConfig.enabled === false) {
      return res.status(400).json({ success: false, message: 'This slot is no longer available. Please choose another.' });
    }

    const step3Data = {
      selectedSlot,
      slotDate: new Date(slotDate),
      step3CompletedAt: new Date()
    };

    console.log('[saveStep3] Attempting to save:', { phone: p, selectedSlot, slotDate });

    // Check timing for immediate SMS sending
    const now = new Date();
    const slotDateTime = new Date(slotDate);
    const hoursUntilSlot = (slotDateTime - now) / (1000 * 60 * 60);
    
    // Send reminder immediately if within 4 hours
    const shouldSendReminderImmediately = hoursUntilSlot <= 4 && hoursUntilSlot > 0;
    // Send meet link immediately if within 1 hour
    const shouldSendMeetLinkImmediately = hoursUntilSlot <= 1 && hoursUntilSlot > 0;
    // Send 30-min live reminder immediately if within 30 minutes (0.5 hours)
    const shouldSendReminder30MinImmediately = hoursUntilSlot <= 0.5 && hoursUntilSlot > 0;

    console.log('[saveStep3] Hours until slot:', hoursUntilSlot.toFixed(2), 
      'Send reminder immediately:', shouldSendReminderImmediately,
      'Send meet link immediately:', shouldSendMeetLinkImmediately,
      'Send 30-min reminder immediately:', shouldSendReminder30MinImmediately);

    const submission = await FormSubmission.findOneAndUpdate(
      { phone: p },
      {
        $set: {
          selectedSlot,
          step3Data,
          currentStep: 3,
          applicationStatus: 'registered',
          isRegistered: true,
          registeredAt: new Date(),
          updatedAt: new Date(),
          // If booking within 4 hours, we'll send reminder immediately and mark as sent
          reminderSent: shouldSendReminderImmediately,
          reminderSentAt: shouldSendReminderImmediately ? new Date() : null,
          // If booking within 1 hour, we'll send meet link immediately and mark as sent
          meetLinkSent: shouldSendMeetLinkImmediately,
          meetLinkSentAt: shouldSendMeetLinkImmediately ? new Date() : null,
          // If booking within 30 min, we'll send 30-min live reminder immediately and mark as sent
          reminder30MinSent: shouldSendReminder30MinImmediately,
          reminder30MinSentAt: shouldSendReminder30MinImmediately ? new Date() : null
        }
      },
      { upsert: false, new: true, runValidators: true }
    );

    if (!submission) {
      console.error('[saveStep3] Document not found for phone:', p);
      return res.status(404).json({ success: false, message: 'Application not found. Please start from Step 1.' });
    }

    console.log('[saveStep3] Save successful. Document ID:', submission._id, 'Registered:', submission.isRegistered);

    await appendToSheetIfConfigured(submission);

    // Send slot confirmation SMS (non-blocking - don't fail the request if SMS fails)
    let smsStatus = { sent: false, error: null };
    let reminderStatus = { sent: false, error: null, immediate: false };
    let meetLinkStatus = { sent: false, error: null, immediate: false };
    let reminder30MinStatus = { sent: false, error: null, immediate: false };
    
    try {
      const smsVariables = {
        name: submission.step1Data?.fullName || submission.fullName || 'Counsellor',
        date: formatSlotDateForSms(slotDate),
        time: formatSlotTimeForSms(selectedSlot)
      };
      
      console.log('[saveStep3] Sending slot confirmation SMS:', { phone: p, variables: smsVariables });
      
      const smsResult = await sendSlotConfirmationSms(p, smsVariables);
      
      if (!smsResult.success) {
        console.warn('[saveStep3] Slot confirmation SMS failed:', smsResult.error);
        smsStatus = { sent: false, error: smsResult.error };
      } else {
        console.log('[saveStep3] Slot confirmation SMS sent successfully');
        smsStatus = { sent: true, error: null };
      }

      // If booking within 4 hours, also send reminder SMS immediately
      if (shouldSendReminderImmediately) {
        console.log('[saveStep3] Slot is within 4 hours - sending reminder SMS immediately');
        
        const reminderResult = await sendReminderSms(p, smsVariables);
        
        if (!reminderResult.success) {
          console.warn('[saveStep3] Immediate reminder SMS failed:', reminderResult.error);
          reminderStatus = { sent: false, error: reminderResult.error, immediate: true };
          // Update reminderSent to false since it failed
          await FormSubmission.updateOne(
            { phone: p },
            { $set: { reminderSent: false, reminderSentAt: null } }
          );
        } else {
          console.log('[saveStep3] Immediate reminder SMS sent successfully');
          reminderStatus = { sent: true, error: null, immediate: true };
        }
      }

      // If booking within 1 hour, also send meet link SMS immediately
      if (shouldSendMeetLinkImmediately) {
        console.log('[saveStep3] Slot is within 1 hour - sending meet link SMS immediately');
        
        // Add meeting link variable (maps to ##var## in MSG91 template)
        const meetLinkVariables = {
          ...smsVariables,
          var: process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo'
        };
        
        const meetLinkResult = await sendMeetLinkSms(p, meetLinkVariables);
        
        if (!meetLinkResult.success) {
          console.warn('[saveStep3] Immediate meet link SMS failed:', meetLinkResult.error);
          meetLinkStatus = { sent: false, error: meetLinkResult.error, immediate: true };
          // Update meetLinkSent to false since it failed
          await FormSubmission.updateOne(
            { phone: p },
            { $set: { meetLinkSent: false, meetLinkSentAt: null } }
          );
        } else {
          console.log('[saveStep3] Immediate meet link SMS sent successfully');
          meetLinkStatus = { sent: true, error: null, immediate: true };
        }
      }

      // If booking within 30 minutes, also send 30-min live reminder SMS immediately
      if (shouldSendReminder30MinImmediately) {
        console.log('[saveStep3] Slot is within 30 min - sending 30-min live reminder SMS immediately');
        
        // Add meeting link variable (maps to ##var## in MSG91 template)
        const reminder30MinVariables = {
          ...smsVariables,
          var: process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo'
        };
        
        const reminder30MinResult = await sendReminder30MinSms(p, reminder30MinVariables);
        
        if (!reminder30MinResult.success) {
          console.warn('[saveStep3] Immediate 30-min reminder SMS failed:', reminder30MinResult.error);
          reminder30MinStatus = { sent: false, error: reminder30MinResult.error, immediate: true };
          // Update reminder30MinSent to false since it failed
          await FormSubmission.updateOne(
            { phone: p },
            { $set: { reminder30MinSent: false, reminder30MinSentAt: null } }
          );
        } else {
          console.log('[saveStep3] Immediate 30-min reminder SMS sent successfully');
          reminder30MinStatus = { sent: true, error: null, immediate: true };
        }
      }
    } catch (smsError) {
      console.error('[saveStep3] Error sending SMS:', smsError.message);
      smsStatus = { sent: false, error: smsError.message };
    }

    otpStore.removeVerified(p);

    return res.status(200).json({
      success: true,
      message: 'Step 3 data saved successfully.',
      data: {
        selectedSlot,
        slotDate: step3Data.slotDate
      },
      smsStatus, // Slot confirmation SMS status
      reminderStatus, // Immediate reminder SMS status (only if slot within 4 hours)
      meetLinkStatus, // Immediate meet link SMS status (only if slot within 1 hour)
      reminder30MinStatus // Immediate 30-min live reminder SMS status (only if slot within 30 min)
    });
  } catch (error) {
    console.error('[saveStep3] Error:', error);
    console.error('[saveStep3] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.checkRegistrationStatus = async (req, res) => {
  try {
    const phone = req.params.phone || req.query.phone;
    
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const submission = await FormSubmission.findOne({ phone: p });

    if (!submission) {
      return res.status(200).json({
        success: true,
        isRegistered: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      isRegistered: submission.isRegistered || false,
      registeredAt: submission.registeredAt,
      slotInfo: submission.step3Data ? {
        selectedSlot: submission.step3Data.selectedSlot,
        slotDate: submission.step3Data.slotDate
      } : null,
      postRegistrationCompleted: !!submission.postRegistrationData?.completedAt,
      applicationStatus: submission.applicationStatus
    });
  } catch (error) {
    console.error('[checkRegistrationStatus] Error:', error);
    console.error('[checkRegistrationStatus] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.savePostRegistrationData = async (req, res) => {
  try {
    const { phone, interestLevel, email } = req.body || {};

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }
    const interestNum = Number(interestLevel);
    if (!Number.isInteger(interestNum) || interestNum < 1 || interestNum > 5) {
      return res.status(400).json({ success: false, message: 'interestLevel must be a number from 1 to 5' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }
    
    // Basic email validation
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    const submission = await FormSubmission.findOne({ phone: p });

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Registration not found. Please complete slot booking first.' });
    }

    if (!submission.isRegistered) {
      return res.status(400).json({ success: false, message: 'User must be registered first.' });
    }

    const postRegistrationData = {
      interestLevel: interestNum,
      email: email.trim().toLowerCase(),
      completedAt: new Date()
    };

    console.log('[savePostRegistrationData] Attempting to save:', { phone: p, interestLevel: interestNum, email: email.trim().toLowerCase() });

    const result = await FormSubmission.findOneAndUpdate(
      { phone: p },
      {
        $set: {
          email: email.trim().toLowerCase(),
          interestLevel: interestNum,
          postRegistrationData,
          currentStep: 4,
          applicationStatus: 'completed',
          updatedAt: new Date()
        }
      },
      { new: true, runValidators: true }
    );

    if (!result) {
      console.error('[savePostRegistrationData] Document not found for phone:', p);
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    console.log('[savePostRegistrationData] Save successful. Document ID:', result._id);

    await appendToSheetIfConfigured(result);

    return res.status(200).json({
      success: true,
      message: 'Post-registration data saved successfully.'
    });
  } catch (error) {
    console.error('[savePostRegistrationData] Error:', error);
    console.error('[savePostRegistrationData] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getAllSubmissions = async (req, res) => {
  try {
    const submissions = await FormSubmission.find({}).sort({ createdAt: -1 }).limit(100);
    const count = await FormSubmission.countDocuments({});
    
    console.log(`[getAllSubmissions] Found ${count} total submissions, returning ${submissions.length}`);
    console.log(`[getAllSubmissions] Collection name: ${FormSubmission.collection.name}`);
    console.log(`[getAllSubmissions] Database name: ${FormSubmission.db.databaseName}`);
    
    return res.status(200).json({
      success: true,
      count,
      collection: FormSubmission.collection.name,
      database: FormSubmission.db.databaseName,
      data: submissions.map(sub => ({
        id: sub._id,
        phone: sub.phone,
        fullName: sub.fullName,
        occupation: sub.occupation,
        currentStep: sub.currentStep,
        applicationStatus: sub.applicationStatus,
        isRegistered: sub.isRegistered,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt
      }))
    });
  } catch (error) {
    console.error('[getAllSubmissions] Error:', error);
    console.error('[getAllSubmissions] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
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
    if (demoInterest === 'YES_SOON' && !isValidSlotId(selectedSlot)) {
      return res.status(400).json({ success: false, message: 'selectedSlot is required and must be a valid slot ID when demoInterest is YES_SOON' });
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

    const created = await FormSubmission.create(doc);
    otpStore.removeVerified(p);

    await appendToSheetIfConfigured(created);

    return res.status(201).json({ success: true, message: 'Application submitted successfully.' });
  } catch (error) {
    console.error('[submitApplication] Error:', error);
    console.error('[submitApplication] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, occupation, demoInterest, selectedSlot } = req.body || {};
    const phone = req.body?.phone || req.body?.whatsappNumber;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Application ID is required' });
    }

    // Find the document
    const submission = await FormSubmission.findById(id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    // Validate input
    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'fullName must be at least 2 characters' });
      }
      submission.fullName = fullName.trim();
    }

    if (phone !== undefined) {
      const p = normalizePhone(phone);
      if (!/^\d{10}$/.test(p)) {
        return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
      }
      submission.phone = p;
    }

    if (occupation !== undefined) {
      if (typeof occupation !== 'string' || !occupation.trim()) {
        return res.status(400).json({ success: false, message: 'occupation is required' });
      }
      submission.occupation = occupation.trim();
    }

    if (demoInterest !== undefined) {
      if (!['YES_SOON', 'MAYBE_LATER'].includes(demoInterest)) {
        return res.status(400).json({ success: false, message: 'demoInterest must be YES_SOON or MAYBE_LATER' });
      }
      submission.demoInterest = demoInterest;
    }

    if (selectedSlot !== undefined) {
      if (submission.demoInterest === 'YES_SOON' && !isValidSlotId(selectedSlot)) {
        return res.status(400).json({ success: false, message: 'selectedSlot must be a valid slot ID when demoInterest is YES_SOON' });
      }
      submission.selectedSlot = selectedSlot;
    }

    // Update MongoDB document
    await submission.save();

    // After DB update succeeds, sync to Google Sheets
    if (submission.sheetRow) {
      try {
        const success = await updateRow(submission.sheetRow, submission);
        if (success) {
          console.log(`[FormController] Updated Google Sheets row ${submission.sheetRow} for submission ${submission._id}`);
        } else {
          console.error(`[FormController] Failed to update Google Sheets row ${submission.sheetRow} for submission ${submission._id}`);
        }
      } catch (sheetError) {
        // Log error but don't fail the API response
        console.error(`[FormController] Google Sheets sync error for submission ${submission._id}:`, sheetError.message);
      }
    } else {
      console.error(`[FormController] Cannot update Google Sheets for submission ${submission._id}: sheetRow is missing`);
    }

    return res.status(200).json({ success: true, message: 'Application updated successfully.', data: submission });
  } catch (error) {
    console.error('[FormController] Update error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.deleteApplication = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Application ID is required' });
    }

    // Find the document and get sheetRow before deletion
    const submission = await FormSubmission.findById(id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const sheetRow = submission.sheetRow;

    // Delete from MongoDB
    await FormSubmission.findByIdAndDelete(id);

    // After DB delete succeeds, mark row as DELETED in Google Sheets
    if (sheetRow) {
      try {
        const success = await markRowDeleted(sheetRow);
        if (success) {
          console.log(`[FormController] Marked Google Sheets row ${sheetRow} as DELETED for submission ${id}`);
        } else {
          console.error(`[FormController] Failed to mark Google Sheets row ${sheetRow} as DELETED for submission ${id}`);
        }
      } catch (sheetError) {
        // Log error but don't fail the API response
        console.error(`[FormController] Google Sheets sync error for submission ${id}:`, sheetError.message);
      }
    } else {
      console.warn(`[FormController] Cannot mark Google Sheets row as DELETED for submission ${id}: sheetRow was missing`);
    }

    return res.status(200).json({ success: true, message: 'Application deleted successfully.' });
  } catch (error) {
    console.error('[FormController] Delete error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
