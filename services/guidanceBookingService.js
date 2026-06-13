const mongoose = require('mongoose');
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const {
  COLLEGE_BUDGET_OPTIONS,
  CURRENT_CLASS_OPTIONS,
  PREFERRED_LANGUAGE_OPTIONS,
  INDIAN_MOBILE_REGEX,
} = require('../constants/oneOnOneCounseling');
const { getGuidanceSlotBookingStatus } = require('../utils/guidanceSlotTimeWindow');
const { ensureGuidancePre30ReminderForLead } = require('./guidanceReminderScheduler');

function normalizePreferredColleges(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function validateBookingPreferences({ collegeBudget, parentOccupation, preferredColleges }) {
  const budget = typeof collegeBudget === 'string' ? collegeBudget.trim() : '';
  if (!COLLEGE_BUDGET_OPTIONS.includes(budget)) {
    return { error: 'Please select college budget per year.', status: 400 };
  }
  const occ = String(parentOccupation || '').trim();
  if (occ.length < 2) {
    return { error: 'Please enter parent occupation (at least 2 characters).', status: 400 };
  }
  if (occ.length > 120) {
    return { error: 'Parent occupation is too long.', status: 400 };
  }
  const colleges = normalizePreferredColleges(preferredColleges);
  if (colleges.length < 1) {
    return { error: 'Please enter at least one preferred college.', status: 400 };
  }
  for (const c of colleges) {
    if (c.length > 150) {
      return { error: 'Each preferred college name must be 150 characters or less.', status: 400 };
    }
  }
  return { collegeBudget: budget, parentOccupation: occ, preferredColleges: colleges };
}

function mapSlotToPublicDTO(slot, counselor) {
  const counselorName = counselor?.name || '';
  const collegeName = counselor?.collegeName || '';
  return {
    id: String(slot._id),
    sessionTitle: slot.sessionTitle,
    slotDate: slot.slotDate,
    slotTime: slot.slotTime,
    maxBookings: slot.maxBookings,
    currentBookings: slot.currentBookings,
    spotsLeft: Math.max(0, slot.maxBookings - slot.currentBookings),
    counselorName,
    collegeName,
    designation: counselor?.designation || '',
  };
}

function mapLeadBasicDTO(doc) {
  return {
    id: String(doc._id),
    studentName: doc.studentName,
    mobileNumber: doc.mobileNumber,
    parentName: doc.parentName,
    currentClass: doc.currentClass,
    city: doc.city || '',
    preferredLanguage: doc.preferredLanguage,
    collegeBudget: doc.collegeBudget || '',
    parentOccupation: doc.parentOccupation || '',
    preferredColleges: Array.isArray(doc.preferredColleges) ? doc.preferredColleges : [],
    bookingConfirmed: !!doc.bookingConfirmed,
    bookingStatus: doc.bookingStatus || 'Not Booked',
    formCompleted: !!doc.formCompleted,
  };
}

function mapLeadBookingDTO(doc, slot, counselor) {
  return {
    ...mapLeadBasicDTO(doc),
    parentAttendanceConfirmed: !!doc.parentAttendanceConfirmed,
    whatsappConsent: !!doc.whatsappConsent,
    selectedSlotId: doc.selectedSlotId ? String(doc.selectedSlotId) : '',
    oneOnOneCounselorId: doc.oneOnOneCounselorId ? String(doc.oneOnOneCounselorId) : '',
    bookingConfirmedAt: doc.bookingConfirmedAt || null,
    attendanceStatus: doc.attendanceStatus || '',
    counselorRemarks: doc.counselorRemarks || '',
    slot: slot
      ? {
          sessionTitle: slot.sessionTitle,
          slotDate: slot.slotDate,
          slotTime: slot.slotTime,
        }
      : null,
    counselor: counselor
      ? { name: counselor.name, collegeName: counselor.collegeName || '' }
      : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function getAvailableActiveSlots() {
  const slots = await GuidanceSlot.find({
    isActive: true,
    $expr: { $lt: ['$currentBookings', '$maxBookings'] },
  })
    .sort({ slotDate: 1, slotTime: 1 })
    .lean();

  const counselorIds = [...new Set(slots.map((s) => String(s.oneOnOneCounselorId)))];
  const counselors = await OneOnOneCounselor.find({
    _id: { $in: counselorIds },
    isActive: true,
  })
    .select('name collegeName designation isActive')
    .lean();
  const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));

  return slots
    .filter((s) => counselorById[String(s.oneOnOneCounselorId)])
    .map((s) => {
      const bookingStatus = getGuidanceSlotBookingStatus(s);
      if (bookingStatus.status === 'ended') {
        return null;
      }
      return {
        ...mapSlotToPublicDTO(s, counselorById[String(s.oneOnOneCounselorId)]),
        bookingClosed: bookingStatus.status === 'frozen',
      };
    })
    .filter(Boolean);
}

async function findLeadByMobile(mobileNumber) {
  return OneOnOneCounselingLead.findOne({ mobileNumber }).lean();
}

function validateGuidanceStudentProfile({ studentName, currentClass, city, preferredLanguage }) {
  const name = String(studentName || '').trim();
  if (name.length < 2 || name.length > 100) {
    return { error: 'Student name must be 2–100 characters.', status: 400 };
  }
  const cls = String(currentClass || '').trim();
  if (!CURRENT_CLASS_OPTIONS.includes(cls)) {
    return { error: 'Please select a valid current class.', status: 400 };
  }
  const cityVal = String(city || '').trim();
  if (cityVal.length < 2 || cityVal.length > 80) {
    return { error: 'City / town must be 2–80 characters.', status: 400 };
  }
  const lang = String(preferredLanguage || '').trim();
  if (!PREFERRED_LANGUAGE_OPTIONS.includes(lang)) {
    return { error: 'Please select a valid preferred language.', status: 400 };
  }
  return {
    studentName: name,
    currentClass: cls,
    city: cityVal,
    preferredLanguage: lang,
  };
}

function trimUtmField(val, maxLen = 120) {
  const s = typeof val === 'string' ? val.trim() : '';
  return s ? s.slice(0, maxLen) : undefined;
}

async function createLeadFromGuidanceBooking({
  mobileNumber,
  studentName,
  currentClass,
  city,
  preferredLanguage,
  collegeBudget,
  parentOccupation,
  preferredColleges,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
}) {
  const lead = new OneOnOneCounselingLead({
    studentName,
    mobileNumber,
    currentClass,
    city,
    preferredLanguage,
    collegeBudget,
    parentOccupation,
    preferredColleges,
    formCompleted: false,
    currentStep: 0,
    leadStatus: 'New Lead',
    utm_source: trimUtmField(utm_source),
    utm_medium: trimUtmField(utm_medium),
    utm_campaign: trimUtmField(utm_campaign),
    utm_content: trimUtmField(utm_content),
  });
  await lead.save();
  return lead;
}

async function bookSlotForLead({
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
}) {
  if (!parentAttendanceConfirmed || !whatsappConsent) {
    return { error: 'Parent attendance and WhatsApp consent are required.', status: 400 };
  }

  const prefs = validateBookingPreferences({
    collegeBudget,
    parentOccupation,
    preferredColleges,
  });
  if (prefs.error) return { error: prefs.error, status: prefs.status };

  let lead = await OneOnOneCounselingLead.findOne({ mobileNumber });
  if (!lead) {
    const profile = validateGuidanceStudentProfile({
      studentName,
      currentClass,
      city,
      preferredLanguage,
    });
    if (profile.error) return { error: profile.error, status: profile.status };

    try {
      lead = await createLeadFromGuidanceBooking({
        mobileNumber,
        studentName: profile.studentName,
        currentClass: profile.currentClass,
        city: profile.city,
        preferredLanguage: profile.preferredLanguage,
        collegeBudget: prefs.collegeBudget,
        parentOccupation: prefs.parentOccupation,
        preferredColleges: prefs.preferredColleges,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
      });
    } catch (err) {
      if (err?.code === 11000) {
        lead = await OneOnOneCounselingLead.findOne({ mobileNumber });
        if (!lead) {
          return { error: 'Could not create your profile. Please try again.', status: 409 };
        }
      } else {
        throw err;
      }
    }
  }

  if (lead.bookingConfirmed) {
    return { error: 'A slot is already booked with this mobile number.', status: 409 };
  }

  if (!mongoose.Types.ObjectId.isValid(slotId)) {
    return { error: 'Invalid slot selected.', status: 400 };
  }

  const slot = await GuidanceSlot.findById(slotId).lean();
  if (!slot || !slot.isActive) {
    return { error: 'Selected slot is not available.', status: 400 };
  }
  if (slot.currentBookings >= slot.maxBookings) {
    return { error: 'Selected slot is full. Please choose another slot.', status: 400 };
  }

  const counselor = await OneOnOneCounselor.findById(slot.oneOnOneCounselorId).lean();
  if (!counselor || !counselor.isActive) {
    return { error: 'Selected slot is not available.', status: 400 };
  }

  const slotBookingStatus = getGuidanceSlotBookingStatus(slot);
  if (slotBookingStatus.status === 'ended') {
    return { error: 'This session slot has already ended. Please choose another slot.', status: 400 };
  }
  if (slotBookingStatus.status === 'frozen') {
    return {
      error: 'Booking for this slot closed 15 minutes before the session start time.',
      status: 403,
    };
  }

  const slotUpdate = await GuidanceSlot.findOneAndUpdate(
    {
      _id: slotId,
      isActive: true,
      $expr: { $lt: ['$currentBookings', '$maxBookings'] },
    },
    { $inc: { currentBookings: 1 } },
    { new: true }
  );
  if (!slotUpdate) {
    return { error: 'Selected slot is full. Please choose another slot.', status: 409 };
  }

  const now = new Date();
  lead.bookingConfirmed = true;
  lead.bookingStatus = 'Confirmed';
  lead.selectedSlotId = slotId;
  lead.oneOnOneCounselorId = slot.oneOnOneCounselorId;
  lead.parentAttendanceConfirmed = true;
  lead.whatsappConsent = true;
  lead.bookingConfirmedAt = now;
  lead.attendanceStatus = 'Confirmed';
  lead.collegeBudget = prefs.collegeBudget;
  lead.parentOccupation = prefs.parentOccupation;
  lead.preferredColleges = prefs.preferredColleges;

  try {
    await lead.save();
  } catch (err) {
    await GuidanceSlot.findByIdAndUpdate(slotId, { $inc: { currentBookings: -1 } });
    throw err;
  }

  let reminderSchedule = null;
  try {
    reminderSchedule = await ensureGuidancePre30ReminderForLead(lead, slotUpdate.toObject());
  } catch (scheduleErr) {
    console.error('[bookSlotForLead] guidance pre30 reminder schedule failed:', scheduleErr?.message || scheduleErr);
  }

  return {
    lead: lead.toObject(),
    slot: slotUpdate.toObject(),
    counselor,
    reminderSchedule,
  };
}

function validateMobile(mobile) {
  return INDIAN_MOBILE_REGEX.test(mobile);
}

module.exports = {
  mapSlotToPublicDTO,
  mapLeadBasicDTO,
  mapLeadBookingDTO,
  getAvailableActiveSlots,
  findLeadByMobile,
  bookSlotForLead,
  validateMobile,
  validateBookingPreferences,
  validateGuidanceStudentProfile,
  createLeadFromGuidanceBooking,
  normalizePreferredColleges,
};
