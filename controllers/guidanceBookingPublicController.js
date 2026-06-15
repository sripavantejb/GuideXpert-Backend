const { to10Digits } = require('../utils/mobileNormalize');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { isGupshupConfigured, sendGuidanceBookingSubmitWhatsApp, sendGuidanceCounsellorBookingNotifyWhatsApp } = require('../services/gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const { resolveGuidanceCounselorPhone10 } = require('../constants/guidanceCounselorPhones');
const {
  buildGuidanceBookingSubmitVars,
  buildGuidanceCounsellorBookingNotifyVars,
  parseGuidanceSlotInstantUtc,
  GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
  GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY,
} = require('../utils/guidanceBookingWhatsApp');
const {
  findLeadByMobile,
  getAvailableActiveSlots,
  bookSlotForLead,
  mapLeadBasicDTO,
  mapLeadBookingDTO,
  validateMobile,
} = require('../services/guidanceBookingService');
const { joinGuidanceMeetForMobile } = require('../services/guidanceMeetJoinService');

function summarizeReminderSchedule(reminderSchedule) {
  if (!reminderSchedule) return null;
  if (reminderSchedule.error) {
    return {
      ok: false,
      error: reminderSchedule.error,
      detail: reminderSchedule.detail || null,
    };
  }
  const job = reminderSchedule.jobs?.[0];
  if (!job) {
    return { ok: false, error: 'no_job_created' };
  }
  return {
    ok: job.state === 'pending',
    state: job.state,
    suppressionReason: job.suppressionReason || null,
    scheduledSendAt: job.scheduledSendAt || null,
  };
}

exports.checkMobile = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.body?.mobileNumber);
    if (!validateMobile(mobileNumber)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number.' });
    }

    const lead = await findLeadByMobile(mobileNumber);
    if (!lead) {
      const slots = await getAvailableActiveSlots();
      return res.status(200).json({
        success: true,
        found: false,
        needsProfile: true,
        needsOtp: true,
        data: { slots },
      });
    }

    if (lead.bookingConfirmed) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadyBooked: true,
        needsOtp: false,
        message: 'A slot is already booked with this mobile number.',
        data: { student: mapLeadBasicDTO(lead) },
      });
    }

    const slots = await getAvailableActiveSlots();
    const formCompleted = !!lead.formCompleted;

    return res.status(200).json({
      success: true,
      found: true,
      alreadyBooked: false,
      needsOtp: !formCompleted,
      data: {
        student: mapLeadBasicDTO(lead),
        slots,
      },
    });
  } catch (err) {
    console.error('[checkMobile]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.getActiveSlots = async (_req, res) => {
  try {
    const slots = await getAvailableActiveSlots();
    return res.status(200).json({ success: true, data: slots });
  } catch (err) {
    console.error('[getActiveSlots]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.bookSlot = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.body?.mobileNumber);
    const slotId = req.body?.slotId;
    const parentAttendanceConfirmed = req.body?.parentAttendanceConfirmed === true;
    const whatsappConsent = req.body?.whatsappConsent === true;
    const { collegeBudget, parentOccupation, preferredColleges } = req.body || {};
    const {
      studentName,
      currentClass,
      city,
      preferredLanguage,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
    } = req.body || {};

    if (!validateMobile(mobileNumber)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number.' });
    }
    if (!slotId) {
      return res.status(400).json({ success: false, message: 'Please select a slot.' });
    }

    const result = await bookSlotForLead({
      mobileNumber,
      slotId,
      parentAttendanceConfirmed,
      whatsappConsent,
      collegeBudget,
      parentOccupation,
      preferredColleges,
      studentName,
      currentClass,
      city,
      preferredLanguage,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
    });

    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }

    let whatsappBooking = null;

    if (!isGupshupConfigured()) {
      whatsappBooking = { attempted: false, skippedReason: 'gupshup_not_configured' };
    } else {
      try {
        const cohortSlotUtc = parseGuidanceSlotInstantUtc(result.slot);
        const bookingGroup = await WhatsAppRetryGroup.create({
          messageKind: 'guidance_booking_submit',
          cronRunId: null,
          trigger: 'guidance_booking_submit',
          status: 'open',
        });
        const waResult = await safeSendWhatsApp({
          phone10: mobileNumber,
          formSubmissionId: null,
          vars: buildGuidanceBookingSubmitVars(result.slot),
          retryKind: 'guidance_booking_submit',
          source: 'guidance_booking_submit',
          cronRunId: null,
          cronJobKey: null,
          sendFn: sendGuidanceBookingSubmitWhatsApp,
          retryGroupId: bookingGroup._id,
          attemptNumber: 1,
          opsProduct: 'guidance_booking',
          cohortSlotInstantUtc: cohortSlotUtc,
          oneOnOneCounselingLeadId: result.lead._id,
          explicitTemplateEnvKey: GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
        });

        if (waResult && waResult.success) {
          whatsappBooking = {
            attempted: true,
            success: true,
            ...(waResult.idempotent ? { idempotent: true } : {}),
          };
        } else {
          const errText =
            waResult && waResult.error ? String(waResult.error).slice(0, 240) : 'send_failed';
          const skippedReason = waResult?.duplicateInFlight
            ? 'duplicate_in_flight'
            : waResult?.skippedOutsideWindow
              ? 'outside_reminder_window'
              : undefined;
          whatsappBooking = {
            attempted: true,
            success: false,
            error: errText,
            ...(skippedReason ? { skippedReason } : {}),
          };
          console.warn('[bookSlot] WhatsApp guidance_booking_submit unsuccessful:', errText);
        }
      } catch (waErr) {
        const msg = String(waErr?.message || waErr || 'exception').slice(0, 240);
        whatsappBooking = { attempted: true, success: false, error: msg };
        if (waErr?.name === 'ValidationError') {
          console.error('[bookSlot] retry_group_validation_failed', msg);
        } else {
          console.error('[bookSlot] WhatsApp dispatch error:', msg);
        }
      }
    }

    let whatsappCounsellor = null;
    const counsellorPhone10 = resolveGuidanceCounselorPhone10(result.counselor);
    const counsellorTemplateId = process.env[GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY];

    if (!isGupshupConfigured()) {
      whatsappCounsellor = { attempted: false, skippedReason: 'gupshup_not_configured' };
    } else if (!counsellorTemplateId) {
      whatsappCounsellor = { attempted: false, skippedReason: 'template_env_missing' };
    } else if (!counsellorPhone10) {
      whatsappCounsellor = { attempted: false, skippedReason: 'counsellor_phone_unresolved' };
    } else {
      try {
        const cohortSlotUtc = parseGuidanceSlotInstantUtc(result.slot);
        const counsellorGroup = await WhatsAppRetryGroup.create({
          messageKind: 'guidance_counsellor_booking_notify',
          cronRunId: null,
          trigger: 'guidance_counsellor_booking_notify',
          status: 'open',
        });
        const counsellorWaResult = await safeSendWhatsApp({
          phone10: counsellorPhone10,
          formSubmissionId: null,
          vars: buildGuidanceCounsellorBookingNotifyVars(result.lead, result.slot, result.counselor),
          retryKind: 'guidance_counsellor_booking_notify',
          source: 'guidance_counsellor_booking_notify',
          cronRunId: null,
          cronJobKey: null,
          sendFn: sendGuidanceCounsellorBookingNotifyWhatsApp,
          retryGroupId: counsellorGroup._id,
          attemptNumber: 1,
          opsProduct: 'guidance_booking',
          cohortSlotInstantUtc: cohortSlotUtc,
          oneOnOneCounselingLeadId: result.lead._id,
          explicitTemplateEnvKey: GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY,
        });

        if (counsellorWaResult && counsellorWaResult.success) {
          whatsappCounsellor = {
            attempted: true,
            success: true,
            ...(counsellorWaResult.idempotent ? { idempotent: true } : {}),
          };
        } else {
          const errText =
            counsellorWaResult && counsellorWaResult.error
              ? String(counsellorWaResult.error).slice(0, 240)
              : 'send_failed';
          const skippedReason = counsellorWaResult?.duplicateInFlight
            ? 'duplicate_in_flight'
            : counsellorWaResult?.skippedOutsideWindow
              ? 'outside_reminder_window'
              : undefined;
          whatsappCounsellor = {
            attempted: true,
            success: false,
            error: errText,
            ...(skippedReason ? { skippedReason } : {}),
          };
          console.warn('[bookSlot] WhatsApp guidance_counsellor_booking_notify unsuccessful:', errText);
        }
      } catch (waErr) {
        const msg = String(waErr?.message || waErr || 'exception').slice(0, 240);
        whatsappCounsellor = { attempted: true, success: false, error: msg };
        if (waErr?.name === 'ValidationError') {
          console.error('[bookSlot] counsellor_retry_group_validation_failed', msg);
        } else {
          console.error('[bookSlot] Counsellor WhatsApp dispatch error:', msg);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message:
        'Your guidance session slot has been booked successfully. Our team will send details on WhatsApp.',
      data: mapLeadBookingDTO(result.lead, result.slot, result.counselor),
      whatsappBooking,
      whatsappCounsellor,
      reminderSchedule: summarizeReminderSchedule(result.reminderSchedule),
    });
  } catch (err) {
    console.error('[bookSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.meetJoin = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.body?.mobileNumber);
    if (!validateMobile(mobileNumber)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number.' });
    }

    const result = await joinGuidanceMeetForMobile(mobileNumber);
    if (result.error) {
      return res.status(result.status || 400).json({
        success: false,
        message: result.error,
        ...(result.data ? { data: result.data } : {}),
      });
    }

    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    console.error('[meetJoin]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
