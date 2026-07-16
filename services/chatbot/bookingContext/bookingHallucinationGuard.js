'use strict';

const { noBookingReply } = require('./bookingSupportRouter');

const BOOKING_CONFIRMATION_PATTERNS = [
  /\bbooking (is )?confirmed\b/i,
  /\b(counselling|counseling) booking\b.{0,80}\bconfirmed\b/i,
  /\bappointment (is )?booked\b/i,
  /\bsession (is )?confirmed\b/i,
  /\bsession (is )?scheduled\b/i,
  /\bmeeting (is )?scheduled\b/i,
  /\bbooked successfully\b/i,
  /\bconfirmation number\b/i,
  /\byour (counselling|counseling) (session )?(is )?(confirmed|booked|scheduled)\b/i,
  /\b(i've|i have|we've|we have) (confirmed|booked|scheduled) (your )?(session|appointment|booking)\b/i,
  /\bconfirmed for (today|tomorrow)\b/i,
  /\bconfirmed for tomorrow at\b/i,
];

function containsBookingConfirmationClaim(text) {
  const value = String(text || '');
  return BOOKING_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(value));
}

function bookingExistsInLeadContext(leadContext) {
  const booking = leadContext?.bookingContext || leadContext?.booking;
  return Boolean(
    booking?.exists ||
      leadContext?.hasBooking ||
      booking?.hasBooking ||
      (leadContext?.hasIit && leadContext?.iit?.slotBooking)
  );
}

/**
 * Block LLM from inventing booking confirmations when CRM has no active booking.
 */
function applyBookingHallucinationGuard({
  response,
  leadContext = null,
  resolvedLanguage = 'en',
} = {}) {
  const text = String(response || '').trim();
  if (!text) {
    return { text, modified: false, reason: null };
  }

  if (bookingExistsInLeadContext(leadContext) || !containsBookingConfirmationClaim(text)) {
    return { text, modified: false, reason: null };
  }

  return {
    text: noBookingReply(resolvedLanguage),
    modified: true,
    reason: 'booking_hallucination_blocked',
  };
}

module.exports = {
  BOOKING_CONFIRMATION_PATTERNS,
  containsBookingConfirmationClaim,
  bookingExistsInLeadContext,
  applyBookingHallucinationGuard,
};
