const { to10Digits } = require('../utils/mobileNormalize');
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
      return res.status(404).json({
        success: false,
        found: false,
        message: 'This mobile number is not found. Please contact the GuideXpert team.',
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
    });

    if (result.error) {
      const lead = await findLeadByMobile(mobileNumber);
      if (!lead && result.status === 404) {
        return res.status(404).json({ success: false, message: result.error });
      }
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }

    return res.status(200).json({
      success: true,
      message:
        'Your guidance session slot has been booked successfully. Our team will send details on WhatsApp.',
      data: mapLeadBookingDTO(result.lead, result.slot, result.counselor),
    });
  } catch (err) {
    console.error('[bookSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
