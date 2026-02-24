const TrainingFeedback = require('../models/TrainingFeedback');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(0, 10);
}

/**
 * POST /api/counsellor/poster-eligibility
 * Check if mobile number exists in trainingfeedbacks (training completed).
 * No auth required; used by counsellor poster download page.
 */
exports.checkPosterEligibility = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.body?.mobileNumber ?? req.query?.mobile ?? '');
    if (mobileNumber.length !== 10) {
      return res.status(400).json({
        success: false,
        eligible: false,
        message: 'Valid 10-digit mobile number is required.',
      });
    }
    const found = await TrainingFeedback.findOne({ mobileNumber }).lean();
    if (found) {
      return res.json({ success: true, eligible: true });
    }
    return res.json({
      success: true,
      eligible: false,
      message: 'Your training is not yet completed. Please complete the training to download the poster.',
    });
  } catch (err) {
    console.error('[checkPosterEligibility]', err);
    return res.status(500).json({
      success: false,
      eligible: false,
      message: 'Unable to check eligibility. Please try again.',
    });
  }
};
