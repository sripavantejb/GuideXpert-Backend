const FormSubmission = require('../models/FormSubmission');
const otpRepository = require('./otpRepository');
const { evaluateLiveWindows, formatIst } = require('./demoMeetLiveWindows');
const { getOrCreateDemoMeetLiveSchedule, toPlainSchedule } = require('../services/demoMeetLiveScheduleService');

const FIVE_MIN_MS = 5 * 60 * 1000;
const SLOT_DURATION_MS = 60 * 60 * 1000;

/**
 * Demo `/meet` gate: requires a completed demo booking once; join times follow **global** live windows (IST), not the lead’s booked slot.
 *
 * @param {string} rawPhone
 * @param {Date} [now]
 * @returns {Promise<{
 *   status: 'allowed'|'too_early'|'no_booking',
 *   message: string,
 *   phone?: string,
 *   selectedSlot?: string|null,
 *   originalBookingSlotStart?: string,
 *   originalBookingSlotStartLabel?: string,
 *   slotStart?: string,
 *   joinOpensAt?: string,
 *   slotEnd?: string,
 *   slotStartLabel?: string,
 *   joinOpensAtLabel?: string,
 *   slotEndLabel?: string
 * }>}
 */
async function getDemoMeetEligibility(rawPhone, now = new Date()) {
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

  const scheduleDoc = await getOrCreateDemoMeetLiveSchedule();
  const schedule = toPlainSchedule(scheduleDoc);
  const live = evaluateLiveWindows(schedule, now);

  const bookingInfo = {
    phone,
    selectedSlot: doc.step3Data?.selectedSlot || null,
    originalBookingSlotStart: slotStart.toISOString(),
    originalBookingSlotStartLabel: formatIst(slotStart),
  };

  if (live.phase === 'no_windows') {
    return {
      status: 'too_early',
      message:
        live.message ||
        'Demo meet join is not configured yet. Please ask an administrator to set live windows.',
      ...bookingInfo,
      joinOpensAtLabel: '',
      slotEndLabel: '',
      slotStartLabel: '',
    };
  }

  if (live.phase === 'too_early') {
    return {
      status: 'too_early',
      message: live.message,
      ...bookingInfo,
      joinOpensAt: live.joinOpensAt,
      slotEnd: live.slotEnd,
      slotStart: live.slotStart,
      joinOpensAtLabel: live.joinOpensAtLabel || '',
      slotEndLabel: live.slotEndLabel || '',
      slotStartLabel: live.slotStartLabel || '',
    };
  }

  return {
    status: 'allowed',
    message: live.message,
    ...bookingInfo,
    joinOpensAt: live.joinOpensAt,
    slotEnd: live.slotEnd,
    slotStart: live.slotStart,
    joinOpensAtLabel: live.joinOpensAtLabel,
    slotEndLabel: live.slotEndLabel,
    slotStartLabel: live.slotStartLabel,
  };
}

module.exports = {
  getDemoMeetEligibility,
  FIVE_MIN_MS,
  SLOT_DURATION_MS,
};
