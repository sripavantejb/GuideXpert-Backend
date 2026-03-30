const FormSubmission = require('../models/FormSubmission');
const otpRepository = require('./otpRepository');

const FIVE_MIN_MS = 5 * 60 * 1000;
const SLOT_DURATION_MS = 60 * 60 * 1000;

const IST_FORMAT = {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
};

function formatIst(date) {
  return new Date(date).toLocaleString('en-IN', IST_FORMAT);
}

/**
 * @param {string} rawPhone
 * @param {Date} [now]
 * @returns {Promise<{
 *   status: 'allowed'|'too_early'|'too_late'|'no_booking',
 *   message: string,
 *   phone?: string,
 *   selectedSlot?: string|null,
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
      message: 'Valid 10-digit mobile number is required.'
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
      phone
    };
  }

  const joinOpensAt = new Date(slotStart.getTime() - FIVE_MIN_MS);
  const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MS);
  const t = now.getTime();

  const slotStartLabel = formatIst(slotStart);
  const joinOpensAtLabel = formatIst(joinOpensAt);
  const slotEndLabel = formatIst(slotEnd);

  const base = {
    phone,
    selectedSlot: doc.step3Data.selectedSlot || null,
    slotStart: slotStart.toISOString(),
    joinOpensAt: joinOpensAt.toISOString(),
    slotEnd: slotEnd.toISOString(),
    slotStartLabel,
    joinOpensAtLabel,
    slotEndLabel
  };

  if (t < joinOpensAt.getTime()) {
    return {
      status: 'too_early',
      message: `Your demo session starts on ${slotStartLabel}. You will be allowed into the meet from ${joinOpensAtLabel} (5 minutes before the session starts).`,
      ...base
    };
  }

  if (t >= slotEnd.getTime()) {
    return {
      status: 'too_late',
      message: 'Your demo session window has ended. Please book a new demo slot if you would like to attend another session.',
      ...base
    };
  }

  return {
    status: 'allowed',
    message: 'You may join the demo meet now.',
    ...base
  };
}

module.exports = {
  getDemoMeetEligibility,
  FIVE_MIN_MS,
  SLOT_DURATION_MS
};
