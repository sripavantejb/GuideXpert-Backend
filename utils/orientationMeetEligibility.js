const TrainingFeedback = require('../models/TrainingFeedback');
const otpRepository = require('./otpRepository');
const { isPrivilegedPhone } = require('./privilegedAccess');

/**
 * `/orientation` gate: phone must exist on activation (TrainingFeedback) as mobile or WhatsApp.
 *
 * @param {string} rawPhone
 * @returns {Promise<{ status: 'allowed' | 'not_eligible', message: string, phone?: string }>}
 */
async function getOrientationMeetEligibility(rawPhone) {
  const phone = otpRepository.normalize(rawPhone);
  if (!phone || phone.length !== 10) {
    return {
      status: 'not_eligible',
      message: 'Valid 10-digit mobile number is required.',
    };
  }

  if (isPrivilegedPhone(phone)) {
    return {
      status: 'allowed',
      message: 'Eligible to join the orientation meet.',
      phone,
    };
  }

  const doc = await TrainingFeedback.findOne({
    $or: [{ mobileNumber: phone }, { whatsappNumber: phone }],
  })
    .select('_id')
    .lean();

  if (!doc) {
    return {
      status: 'not_eligible',
      message:
        'We could not find an activation form submission for this number. Please complete the activation form first, then try again.',
      phone,
    };
  }

  return {
    status: 'allowed',
    message: 'Eligible to join the orientation meet.',
    phone,
  };
}

module.exports = {
  getOrientationMeetEligibility,
};
