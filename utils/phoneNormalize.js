'use strict';

/**
 * Normalize any phone input to a 10-digit string (last 10 digits).
 * Used for cross-collection joins (MeetingAttendance, assessments, etc.).
 */
function normalizePhoneTo10(value) {
  if (value == null) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Strict 10-digit validation (matches WhatsApp / FormSubmission schema). */
function normalizePhone10Strict(value) {
  const phone10 = String(value || '').trim();
  return /^\d{10}$/.test(phone10) ? phone10 : null;
}

module.exports = {
  normalizePhoneTo10,
  normalizePhone10Strict,
};
