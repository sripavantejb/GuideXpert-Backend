const {
  CounsellorSupportRequest,
  COUNSELLOR_SUPPORT_ENUMS,
} = require('../models/CounsellorSupportRequest');

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function parseField(value) {
  return typeof value === 'string' ? value.trim() : '';
}

exports.submitCounsellorSupportRequest = async (req, res) => {
  try {
    const body = req.body || {};
    const name = parseField(body.name);
    const registeredMobileNumber = normalizePhone(body.registeredMobileNumber);
    const dashboardLeadBucket = parseField(body.dashboardLeadBucket);
    const contactedLeadBucket = parseField(body.contactedLeadBucket);
    const natLeadBucket = parseField(body.natLeadBucket);
    const stuckStage = parseField(body.stuckStage);
    const supportNeeded = parseField(body.supportNeeded);
    const otherQuestions = parseField(body.otherQuestions);

    if (name.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }
    if (!/^\d{10}$/.test(registeredMobileNumber)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit registered mobile number is required.' });
    }
    if (!COUNSELLOR_SUPPORT_ENUMS.dashboardLeadBucketValues.includes(dashboardLeadBucket)) {
      return res.status(400).json({ success: false, message: 'Please select leads currently in dashboard.' });
    }
    if (!COUNSELLOR_SUPPORT_ENUMS.contactedLeadBucketValues.includes(contactedLeadBucket)) {
      return res.status(400).json({ success: false, message: 'Please select contacted leads count.' });
    }
    if (!COUNSELLOR_SUPPORT_ENUMS.natLeadBucketValues.includes(natLeadBucket)) {
      return res.status(400).json({ success: false, message: 'Please select leads close to NAT institution.' });
    }
    if (!COUNSELLOR_SUPPORT_ENUMS.stuckStageValues.includes(stuckStage)) {
      return res.status(400).json({ success: false, message: 'Please select your stuck stage.' });
    }
    if (!COUNSELLOR_SUPPORT_ENUMS.supportNeedValues.includes(supportNeeded)) {
      return res.status(400).json({ success: false, message: 'Please select support needed.' });
    }

    const doc = await CounsellorSupportRequest.create({
      name,
      registeredMobileNumber,
      dashboardLeadBucket,
      contactedLeadBucket,
      natLeadBucket,
      stuckStage,
      supportNeeded,
      otherQuestions: otherQuestions.slice(0, 3000),
    });

    return res.status(201).json({
      success: true,
      message: 'Support request submitted successfully.',
      data: {
        id: doc._id,
        createdAt: doc.createdAt,
      },
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      const message = Object.values(error.errors || {})
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: message || 'Validation failed.' });
    }
    console.error('[submitCounsellorSupportRequest]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
