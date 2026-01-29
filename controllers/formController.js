const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const otpStore = require('../utils/otpStore');
const { sendWhatsAppOTP } = require('../utils/gupshupService');
const { getDemoSlots } = require('../utils/demoSlots');
const { appendFormSubmission } = require('../utils/sheetsService');
const FormSubmission = require('../models/FormSubmission');
const { appendRow, updateRow, markRowDeleted } = require('../utils/googleSheetsService');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Sheet1';

async function appendToSheetIfConfigured(submission) {
  if (!GOOGLE_SHEET_ID || !submission) return;
  try {
    const result = await appendFormSubmission(GOOGLE_SHEET_ID, submission, GOOGLE_SHEET_RANGE);
    if (!result.success) {
      console.error('[Sheets] Append failed (best-effort):', result.error);
    }
  } catch (err) {
    console.error('[Sheets] Append error (best-effort):', err.message);
  }
}

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
    if (!selectedSlot || !['SATURDAY_7PM', 'SUNDAY_3PM'].includes(selectedSlot)) {
      return res.status(400).json({ success: false, message: 'selectedSlot must be SATURDAY_7PM or SUNDAY_3PM' });
    }
    if (!slotDate || isNaN(new Date(slotDate).getTime())) {
      return res.status(400).json({ success: false, message: 'Valid slotDate is required' });
    }

    if (!otpStore.isVerified(p)) {
      return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
    }

    const step3Data = {
      selectedSlot,
      slotDate: new Date(slotDate),
      step3CompletedAt: new Date()
    };

    console.log('[saveStep3] Attempting to save:', { phone: p, selectedSlot, slotDate });

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
          updatedAt: new Date()
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

    otpStore.removeVerified(p);

    return res.status(200).json({
      success: true,
      message: 'Step 3 data saved successfully.',
      data: {
        selectedSlot,
        slotDate: step3Data.slotDate
      }
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
    if (!interestLevel || !['VERY_INTERESTED', 'SOMEWHAT_INTERESTED', 'EXPLORING'].includes(interestLevel)) {
      return res.status(400).json({ success: false, message: 'interestLevel must be VERY_INTERESTED, SOMEWHAT_INTERESTED, or EXPLORING' });
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
      interestLevel,
      email: email.trim().toLowerCase(),
      completedAt: new Date()
    };

    console.log('[savePostRegistrationData] Attempting to save:', { phone: p, interestLevel, email: email.trim().toLowerCase() });

    const result = await FormSubmission.findOneAndUpdate(
      { phone: p },
      {
        $set: {
          email: email.trim().toLowerCase(),
          interestLevel,
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
      if (submission.demoInterest === 'YES_SOON' && !['SATURDAY_7PM', 'SUNDAY_3PM'].includes(selectedSlot)) {
        return res.status(400).json({ success: false, message: 'selectedSlot must be SATURDAY_7PM or SUNDAY_3PM when demoInterest is YES_SOON' });
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
