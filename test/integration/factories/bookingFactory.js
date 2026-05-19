'use strict';

const FormSubmission = require('../../../models/FormSubmission');

let phoneSeq = 9000000000;

function nextPhone() {
  phoneSeq += 1;
  return String(phoneSeq);
}

/**
 * @param {{ phone?: string, slotDate?: Date|string, slotTime?: string }} [overrides]
 */
async function createBooking(overrides = {}) {
  const phone = overrides.phone || nextPhone();
  const slotDate = overrides.slotDate
    ? new Date(overrides.slotDate)
    : new Date('2026-05-15T11:30:00.000Z');
  const slotTime = overrides.slotTime || '11AM';
  const sub = await FormSubmission.create({
    fullName: 'Test User',
    phone,
    occupation: 'Student',
    isRegistered: true,
    currentStep: 3,
    step3Data: {
      selectedSlot: `2026-05-15_${slotTime}`,
      slotDate,
      step3CompletedAt: new Date()
    }
  });
  return sub.toObject();
}

module.exports = {
  createBooking,
  nextPhone
};
