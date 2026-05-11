const FormSubmission = require('../models/FormSubmission');
const otpRepository = require('./otpRepository');
const { formatIst } = require('./demoMeetLiveWindows');

const FIVE_MIN_MS = 5 * 60 * 1000;
const SLOT_DURATION_MS = 60 * 60 * 1000;

/**
 * Demo `/meet` gate: requires a completed demo booking once. **Live IST windows are not enforced**
 * (anyone with the link who passes OTP and has a booking may join at any time).
 *
 * @param {string} rawPhone
 * @param {Date} [_now] unused; kept for API stability / tests
 * @returns {Promise<{
 *   status: 'allowed'|'no_booking',
 *   message: string,
 *   phone?: string,
 *   selectedSlot?: string|null,
 *   originalBookingSlotStart?: string,
 *   originalBookingSlotStartLabel?: string,
 *   slotStart?: string,
 *   joinOpensAt?: string|null,
 *   slotEnd?: string|null,
 *   slotStartLabel?: string,
 *   joinOpensAtLabel?: string,
 *   slotEndLabel?: string
 * }>}
 */
async function getDemoMeetEligibility(rawPhone, _now = new Date()) {
  const phone = otpRepository.normalize(rawPhone);
  if (!phone || phone.length !== 10) {
    return {
      status: 'no_booking',
      message: 'Valid 10-digit mobile number is required.',
    };
  }

  const doc = await FormSubmission.findOne({ phone })
    .select('step3Data isRegistered currentStep')
    .lean();

  const slotDate = doc?.step3Data?.slotDate;
  const slotStart = slotDate != null ? new Date(slotDate) : null;
  const hasValidSlot =
    doc &&
    doc.isRegistered === true &&
    typeof doc.currentStep === 'number' &&
    doc.currentStep >= 3 &&
    slotStart &&
    !Number.isNaN(slotStart.getTime());

  if (!hasValidSlot) {
    return {
      status: 'no_booking',
      message:
        'We could not find a registered demo booking for this number. Please complete registration and book a demo slot first.',
      phone,
    };
  }

  const bookingInfo = {
    phone,
    selectedSlot: doc.step3Data?.selectedSlot || null,
    originalBookingSlotStart: slotStart.toISOString(),
    originalBookingSlotStartLabel: formatIst(slotStart),
  };

  return {
    status: 'allowed',
    message: 'You may join the live demo now.',
    ...bookingInfo,
    slotStart: slotStart.toISOString(),
    joinOpensAt: null,
    slotEnd: null,
    joinOpensAtLabel: '',
    slotEndLabel: '',
    slotStartLabel: formatIst(slotStart),
  };
}

module.exports = {
  getDemoMeetEligibility,
  FIVE_MIN_MS,
  SLOT_DURATION_MS,
};
