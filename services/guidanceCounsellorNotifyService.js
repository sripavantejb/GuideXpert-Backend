/**
 * Immediate guidance counsellor booking WhatsApp notify (shared by book-slot and repair cron).
 */
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { resolveGuidanceCounselorPhone10 } = require('../constants/guidanceCounselorPhones');
const { isGupshupConfigured, sendGuidanceCounsellorBookingNotifyWhatsApp } = require('./gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const {
  GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY,
  buildGuidanceCounsellorBookingNotifyVars,
  parseGuidanceSlotInstantUtc,
} = require('../utils/guidanceBookingWhatsApp');

/**
 * @param {object} lead OneOnOneCounselingLead doc/object
 * @param {object} slot GuidanceSlot doc/object
 * @param {object} counselor OneOnOneCounselor doc/object
 * @returns {Promise<{ attempted: boolean, success?: boolean, skippedReason?: string, error?: string }>}
 */
async function sendGuidanceCounsellorBookingNotifyForBooking(lead, slot, counselor) {
  const counsellorPhone10 = resolveGuidanceCounselorPhone10(counselor);
  const counsellorTemplateId = process.env[GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY];

  if (!isGupshupConfigured()) {
    return { attempted: false, skippedReason: 'gupshup_not_configured' };
  }
  if (!counsellorTemplateId) {
    return { attempted: false, skippedReason: 'template_env_missing' };
  }
  if (!counsellorPhone10) {
    return { attempted: false, skippedReason: 'counsellor_phone_unresolved' };
  }
  if (!lead?._id) {
    return { attempted: false, skippedReason: 'missing_lead' };
  }

  const cohortSlotUtc = parseGuidanceSlotInstantUtc(slot);
  const counsellorGroup = await WhatsAppRetryGroup.create({
    messageKind: 'guidance_counsellor_booking_notify',
    cronRunId: null,
    trigger: 'guidance_counsellor_booking_notify',
    status: 'open',
  });

  const counsellorWaResult = await safeSendWhatsApp({
    phone10: counsellorPhone10,
    formSubmissionId: null,
    vars: buildGuidanceCounsellorBookingNotifyVars(lead, slot, counselor),
    retryKind: 'guidance_counsellor_booking_notify',
    source: 'guidance_counsellor_booking_notify',
    cronRunId: null,
    cronJobKey: null,
    sendFn: sendGuidanceCounsellorBookingNotifyWhatsApp,
    retryGroupId: counsellorGroup._id,
    attemptNumber: 1,
    opsProduct: 'guidance_booking',
    cohortSlotInstantUtc: cohortSlotUtc,
    oneOnOneCounselingLeadId: lead._id,
    explicitTemplateEnvKey: GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY,
  });

  if (counsellorWaResult && counsellorWaResult.success) {
    return {
      attempted: true,
      success: true,
      ...(counsellorWaResult.idempotent ? { idempotent: true } : {}),
    };
  }

  const errText =
    counsellorWaResult && counsellorWaResult.error
      ? String(counsellorWaResult.error).slice(0, 240)
      : 'send_failed';
  const skippedReason = counsellorWaResult?.duplicateInFlight
    ? 'duplicate_in_flight'
    : counsellorWaResult?.skippedOutsideWindow
      ? 'outside_reminder_window'
      : undefined;

  return {
    attempted: true,
    success: false,
    error: errText,
    ...(skippedReason ? { skippedReason } : {}),
  };
}

module.exports = {
  sendGuidanceCounsellorBookingNotifyForBooking,
};
