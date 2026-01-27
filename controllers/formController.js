const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const otpStore = require('../utils/otpStore');
const { sendWhatsAppOTP } = require('../utils/gupshupService');
const { getDemoSlots } = require('../utils/demoSlots');
const FormSubmission = require('../models/FormSubmission');
const { appendRow, updateRow, markRowDeleted } = require('../utils/googleSheetsService');

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

    // Insert document into MongoDB
    const submission = await FormSubmission.create(doc);
    otpStore.removeVerified(p);

    // After DB insert succeeds, sync to Google Sheets
    try {
      const rowNumber = await appendRow(submission);
      if (rowNumber) {
        // Save the row number back to the document
        submission.sheetRow = rowNumber;
        await submission.save();
        console.log(`[FormController] Saved sheetRow ${rowNumber} for submission ${submission._id}`);
      } else {
        console.error(`[FormController] Failed to append to Google Sheets for submission ${submission._id}`);
      }
    } catch (sheetError) {
      // Log error but don't fail the API response
      console.error(`[FormController] Google Sheets sync error for submission ${submission._id}:`, sheetError.message);
    }

    return res.status(201).json({ success: true, message: 'Application submitted successfully.' });
  } catch {
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
