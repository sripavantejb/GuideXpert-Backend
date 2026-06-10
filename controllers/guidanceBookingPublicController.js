const { to10Digits } = require('../utils/mobileNormalize');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { isGupshupConfigured, sendGuidanceBookingSubmitWhatsApp } = require('../services/gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const {
  buildGuidanceBookingSubmitVars,
  parseGuidanceSlotInstantUtc,
  GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
} = require('../utils/guidanceBookingWhatsApp');
const {
  findLeadByMobile,
  getAvailableActiveSlots,
  bookSlotForLead,
  mapLeadBasicDTO,
  mapLeadBookingDTO,
  validateMobile,
} = require('../services/guidanceBookingService');

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
        data: { slots },
      });
    }

    if (lead.bookingConfirmed) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadyBooked: true,
        message: 'A slot is already booked with this mobile number.',
        data: { student: mapLeadBasicDTO(lead) },
      });
    }

    const slots = await getAvailableActiveSlots();

    return res.status(200).json({
      success: true,
      found: true,
      alreadyBooked: false,
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

    return res.status(200).json({
      success: true,
      message:
        'Your guidance session slot has been booked successfully. Our team will send details on WhatsApp.',
      data: mapLeadBookingDTO(result.lead, result.slot, result.counselor),
      whatsappBooking,
    });
  } catch (err) {
    console.error('[bookSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
