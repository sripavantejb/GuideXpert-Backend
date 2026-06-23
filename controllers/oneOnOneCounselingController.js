const mongoose = require('mongoose');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');
const {
  CURRENT_CLASS_OPTIONS,
  INTERESTED_BRANCH_OPTIONS,
  COLLEGE_BUDGET_OPTIONS,
  BIGGEST_CONCERN_OPTIONS,
  PREFERRED_LANGUAGE_OPTIONS,
  SESSION_ATTENDEE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  INDIAN_MOBILE_REGEX,
} = require('../constants/oneOnOneCounseling');
const { isValidPreferredTimeSlot, resolveSlotMeta } = require('../utils/oneOnOneCounselingSlots');
const { buildLeadRelevanceMatchClause } = require('../utils/oneOnOneCounselingClassRelevance');
const { BOOKING_STATUS_OPTIONS } = require('../constants/guidanceBooking');
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { isGupshupConfigured, sendOneOnOneSubmitWhatsApp } = require('../services/gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const {
  buildOneOnOneSubmitVars,
  parsePreferredSlotInstantUtc,
  GUPSHUP_TEMPLATE_ONE_ON_ONE_CONFIRM,
} = require('../utils/oneOnOneCounselingWhatsApp');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(-10).slice(0, 10);
}

function parseISODate(str) {
  if (str == null || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildDateRange(from, to) {
  const range = {};
  const start = parseISODate(from);
  if (start) {
    start.setUTCHours(0, 0, 0, 0);
    range.$gte = start;
  }
  const end = parseISODate(to);
  if (end) {
    end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return Object.keys(range).length ? range : null;
}

function mapLeadToDTO(doc) {
  return {
    id: doc._id,
    studentName: doc.studentName,
    mobileNumber: doc.mobileNumber,
    parentName: doc.parentName,
    parentMobileNumber: doc.parentMobileNumber,
    sessionAttendee: doc.sessionAttendee || '',
    currentClass: doc.currentClass,
    city: doc.city || '',
    entranceExamRank: doc.entranceExamRank,
    interestedBranch: doc.interestedBranch,
    collegeBudget: doc.collegeBudget,
    biggestConcern: doc.biggestConcern,
    preferredLanguage: doc.preferredLanguage,
    preferredTimeSlot: doc.preferredTimeSlot,
    preferredTimeSlotDate: doc.preferredTimeSlotDate || '',
    additionalQuestions: doc.additionalQuestions || '',
    leadStatus: doc.leadStatus || 'New Lead',
    utm_source: doc.utm_source || '',
    utm_medium: doc.utm_medium || '',
    utm_campaign: doc.utm_campaign || '',
    utm_content: doc.utm_content || '',
    bookingConfirmed: !!doc.bookingConfirmed,
    bookingStatus: doc.bookingStatus || 'Not Booked',
    selectedSlotId: doc.selectedSlotId ? String(doc.selectedSlotId) : '',
    oneOnOneCounselorId: doc.oneOnOneCounselorId ? String(doc.oneOnOneCounselorId) : '',
    formCompleted: !!doc.formCompleted,
    currentStep: doc.currentStep || 0,
    parentAttendanceConfirmed: !!doc.parentAttendanceConfirmed,
    whatsappConsent: !!doc.whatsappConsent,
    bookingConfirmedAt: doc.bookingConfirmedAt || null,
    attendanceStatus: doc.attendanceStatus || '',
    counselorRemarks: doc.counselorRemarks || '',
    parentOccupation: doc.parentOccupation || '',
    preferredColleges: Array.isArray(doc.preferredColleges) ? doc.preferredColleges : [],
    slotSessionTitle: doc._slotSessionTitle || '',
    slotDate: doc._slotDate || '',
    slotTime: doc._slotTime || '',
    counselorName: doc._counselorName || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function applyUtmFilters(match, query) {
  const utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  for (const key of utmFields) {
    const val = typeof query[key] === 'string' ? query[key].trim() : '';
    if (val) {
      match[key] = { $regex: val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
  }
}

function validateSubmitBody(b) {
  const studentName = (b.studentName && String(b.studentName).trim()) || '';
  const mobileNumber = to10Digits(b.mobileNumber);
  const sessionAttendee = (b.sessionAttendee && String(b.sessionAttendee).trim()) || '';
  const currentClass = (b.currentClass && String(b.currentClass).trim()) || '';
  const interestedBranch = (b.interestedBranch && String(b.interestedBranch).trim()) || '';
  const collegeBudget = (b.collegeBudget && String(b.collegeBudget).trim()) || '';
  const preferredLanguage = (b.preferredLanguage && String(b.preferredLanguage).trim()) || '';
  const preferredTimeSlotKey = (b.preferredTimeSlot && String(b.preferredTimeSlot).trim()) || '';

  if (studentName.length < 2 || studentName.length > 100) {
    return { error: 'Student name must be 2–100 characters.' };
  }
  if (!INDIAN_MOBILE_REGEX.test(mobileNumber)) {
    return { error: 'Enter a valid 10-digit Indian mobile number for the student.' };
  }
  if (!SESSION_ATTENDEE_OPTIONS.includes(sessionAttendee)) {
    return { error: 'Please select who will attend the session.' };
  }
  if (!CURRENT_CLASS_OPTIONS.includes(currentClass)) {
    return { error: 'Please select a valid current class.' };
  }
  if (!INTERESTED_BRANCH_OPTIONS.includes(interestedBranch)) {
    return { error: 'Please select a valid branch.' };
  }
  if (!COLLEGE_BUDGET_OPTIONS.includes(collegeBudget)) {
    return { error: 'Please select a valid college budget.' };
  }
  if (!PREFERRED_LANGUAGE_OPTIONS.includes(preferredLanguage)) {
    return { error: 'Please select a valid language.' };
  }
  if (!isValidPreferredTimeSlot(preferredTimeSlotKey)) {
    return { error: 'Please select a valid session slot for the next 2 days.' };
  }
  const slotMeta = resolveSlotMeta(preferredTimeSlotKey);
  if (!slotMeta) {
    return { error: 'Please select a valid session slot for the next 2 days.' };
  }

  return {
    data: {
      studentName,
      mobileNumber,
      sessionAttendee,
      currentClass,
      interestedBranch,
      collegeBudget,
      preferredLanguage,
      preferredTimeSlot: slotMeta.label,
      preferredTimeSlotDate: slotMeta.slotDate,
      formCompleted: true,
      currentStep: 2,
      utm_source: (b.utm_source && String(b.utm_source).trim().slice(0, 120)) || undefined,
      utm_medium: (b.utm_medium && String(b.utm_medium).trim().slice(0, 120)) || undefined,
      utm_campaign: (b.utm_campaign && String(b.utm_campaign).trim().slice(0, 120)) || undefined,
      utm_content: (b.utm_content && String(b.utm_content).trim().slice(0, 120)) || undefined,
    },
  };
}

function validateSection1Body(b) {
  const studentName = (b.studentName && String(b.studentName).trim()) || '';
  const mobileNumber = to10Digits(b.mobileNumber);
  const currentClass = (b.currentClass && String(b.currentClass).trim()) || '';

  if (studentName.length < 2 || studentName.length > 100) {
    return { error: 'Student name must be 2–100 characters.' };
  }
  if (!INDIAN_MOBILE_REGEX.test(mobileNumber)) {
    return { error: 'Enter a valid 10-digit Indian mobile number for the student.' };
  }
  if (!CURRENT_CLASS_OPTIONS.includes(currentClass)) {
    return { error: 'Please select a valid current class.' };
  }

  return {
    data: {
      studentName,
      mobileNumber,
      currentClass,
      currentStep: 1,
      formCompleted: false,
      utm_source: (b.utm_source && String(b.utm_source).trim().slice(0, 120)) || undefined,
      utm_medium: (b.utm_medium && String(b.utm_medium).trim().slice(0, 120)) || undefined,
      utm_campaign: (b.utm_campaign && String(b.utm_campaign).trim().slice(0, 120)) || undefined,
      utm_content: (b.utm_content && String(b.utm_content).trim().slice(0, 120)) || undefined,
    },
  };
}

function validateSection2Body(b) {
  const sessionAttendee = (b.sessionAttendee && String(b.sessionAttendee).trim()) || '';
  const interestedBranch = (b.interestedBranch && String(b.interestedBranch).trim()) || '';
  const collegeBudget = (b.collegeBudget && String(b.collegeBudget).trim()) || '';
  const preferredLanguage = (b.preferredLanguage && String(b.preferredLanguage).trim()) || '';
  const preferredTimeSlotKey = (b.preferredTimeSlot && String(b.preferredTimeSlot).trim()) || '';

  if (!SESSION_ATTENDEE_OPTIONS.includes(sessionAttendee)) {
    return { error: 'Please select who will attend the session.' };
  }
  if (!INTERESTED_BRANCH_OPTIONS.includes(interestedBranch)) {
    return { error: 'Please select a valid branch.' };
  }
  if (!COLLEGE_BUDGET_OPTIONS.includes(collegeBudget)) {
    return { error: 'Please select a valid college budget.' };
  }
  if (!PREFERRED_LANGUAGE_OPTIONS.includes(preferredLanguage)) {
    return { error: 'Please select a valid language.' };
  }
  if (!isValidPreferredTimeSlot(preferredTimeSlotKey)) {
    return { error: 'Please select a valid session slot for the next 2 days.' };
  }
  const slotMeta = resolveSlotMeta(preferredTimeSlotKey);
  if (!slotMeta) {
    return { error: 'Please select a valid session slot for the next 2 days.' };
  }
  if (b.parentAttendanceConfirmed !== true) {
    return { error: 'Please confirm that you will attend the session with your parent.' };
  }

  return {
    data: {
      sessionAttendee,
      interestedBranch,
      collegeBudget,
      preferredLanguage,
      preferredTimeSlot: slotMeta.label,
      preferredTimeSlotDate: slotMeta.slotDate,
      parentAttendanceConfirmed: true,
      currentStep: 2,
      formCompleted: true,
    },
  };
}

function validateSection3Body(b) {
  const preferredLanguage = (b.preferredLanguage && String(b.preferredLanguage).trim()) || '';
  const preferredTimeSlotKey = (b.preferredTimeSlot && String(b.preferredTimeSlot).trim()) || '';
  const additionalQuestions =
    (b.additionalQuestions && String(b.additionalQuestions).trim().slice(0, 2000)) || '';

  if (!PREFERRED_LANGUAGE_OPTIONS.includes(preferredLanguage)) {
    return { error: 'Please select a valid language.' };
  }
  if (!isValidPreferredTimeSlot(preferredTimeSlotKey)) {
    return { error: 'Please select a valid session slot for the next 2 days.' };
  }
  const slotMeta = resolveSlotMeta(preferredTimeSlotKey);
  if (!slotMeta) {
    return { error: 'Please select a valid session slot for the next 2 days.' };
  }

  return {
    data: {
      preferredLanguage,
      preferredTimeSlot: slotMeta.label,
      preferredTimeSlotDate: slotMeta.slotDate,
      additionalQuestions,
      currentStep: 3,
      formCompleted: true,
    },
  };
}

async function linkOneOnOneLeadToVisit(doc, body) {
  try {
    const visitorFingerprint =
      typeof body?.visitorFingerprint === 'string' ? body.visitorFingerprint.trim() : '';
    if (visitorFingerprint) {
      await IitCounsellingVisit.findOneAndUpdate(
        { visitorFingerprint, pageKey: 'oneOnOneSession', oneOnOneCounselingLeadId: null },
        { $set: { oneOnOneCounselingLeadId: doc._id } },
        { sort: { visitedAt: -1 } }
      );
    } else if (doc.utm_content) {
      const visitMatch = {
        pageKey: 'oneOnOneSession',
        oneOnOneCounselingLeadId: null,
        utm_content: doc.utm_content,
      };
      if (doc.utm_campaign) visitMatch.utm_campaign = doc.utm_campaign;
      if (doc.utm_source) visitMatch.utm_source = doc.utm_source;
      if (doc.utm_medium) visitMatch.utm_medium = doc.utm_medium;
      await IitCounsellingVisit.findOneAndUpdate(
        visitMatch,
        { $set: { oneOnOneCounselingLeadId: doc._id } },
        { sort: { visitedAt: -1 } }
      );
    }
  } catch (linkErr) {
    console.warn(
      '[oneOnOneCounseling] visit attribution link failed (lead saved):',
      linkErr?.message || linkErr
    );
  }
}

async function dispatchOneOnOneSubmitWhatsApp(doc) {
  /** @type {{ attempted: boolean, success?: boolean, skippedReason?: string, error?: string, idempotent?: boolean }|null} */
  let whatsappSubmit = null;

  if (!isGupshupConfigured()) {
    whatsappSubmit = { attempted: false, skippedReason: 'gupshup_not_configured' };
  } else {
    try {
      const cohortSlotUtc = parsePreferredSlotInstantUtc(doc);
      const submitGroup = await WhatsAppRetryGroup.create({
        messageKind: 'one_on_one_submit',
        cronRunId: null,
        trigger: 'one_on_one_submit',
        status: 'open',
      });
      const waResult = await safeSendWhatsApp({
        phone10: doc.mobileNumber,
        formSubmissionId: null,
        vars: buildOneOnOneSubmitVars(doc),
        retryKind: 'one_on_one_submit',
        source: 'one_on_one_submit',
        cronRunId: null,
        cronJobKey: null,
        sendFn: sendOneOnOneSubmitWhatsApp,
        retryGroupId: submitGroup._id,
        attemptNumber: 1,
        opsProduct: 'one_on_one_counseling',
        cohortSlotInstantUtc: cohortSlotUtc,
        oneOnOneCounselingLeadId: doc._id,
        explicitTemplateEnvKey: GUPSHUP_TEMPLATE_ONE_ON_ONE_CONFIRM,
      });

      if (waResult && waResult.success) {
        whatsappSubmit = {
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
        whatsappSubmit = {
          attempted: true,
          success: false,
          error: errText,
          ...(skippedReason ? { skippedReason } : {}),
        };
        console.warn('[oneOnOneCounseling] WhatsApp one_on_one_submit unsuccessful:', errText);
      }
    } catch (waErr) {
      const msg = String(waErr?.message || waErr || 'exception').slice(0, 240);
      whatsappSubmit = { attempted: true, success: false, error: msg };
      if (waErr?.name === 'ValidationError') {
        console.error('[oneOnOneCounseling] retry_group_validation_failed', msg);
      } else {
        console.error('[oneOnOneCounseling] WhatsApp dispatch error:', msg);
      }
    }
  }

  return whatsappSubmit;
}

function parseLeadId(body) {
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : '';
  if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
    return { error: 'Valid leadId is required.' };
  }
  return { leadId };
}

/**
 * POST /api/one-on-one-counseling/section1 — save step 1 (student details)
 */
exports.saveOneOnOneSection1 = async (req, res) => {
  try {
    const validated = validateSection1Body(req.body || {});
    if (validated.error) {
      return res.status(400).json({ success: false, message: validated.error });
    }

    const doc = await OneOnOneCounselingLead.findOneAndUpdate(
      { mobileNumber: validated.data.mobileNumber, formCompleted: { $ne: true } },
      { $set: validated.data },
      { upsert: true, new: true, runValidators: true, validateModifiedOnly: true }
    );

    await linkOneOnOneLeadToVisit(doc, req.body || {});

    return res.status(200).json({
      success: true,
      message: 'Step 1 saved successfully.',
      data: { leadId: doc._id.toString(), currentStep: 1, formCompleted: false },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'An in-progress booking with this mobile number already exists.',
      });
    }
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[saveOneOnOneSection1]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/**
 * POST /api/one-on-one-counseling/section2 — save step 2 and complete booking
 */
exports.saveOneOnOneSection2 = async (req, res) => {
  try {
    const idParsed = parseLeadId(req.body || {});
    if (idParsed.error) {
      return res.status(400).json({ success: false, message: idParsed.error });
    }

    const validated = validateSection2Body(req.body || {});
    if (validated.error) {
      return res.status(400).json({ success: false, message: validated.error });
    }

    const existing = await OneOnOneCounselingLead.findOne({
      _id: idParsed.leadId,
      formCompleted: { $ne: true },
    }).lean();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already completed. Please start from step 1.',
      });
    }

    if (!existing.studentName || !existing.mobileNumber || !existing.currentClass) {
      return res.status(400).json({
        success: false,
        message: 'Please complete step 1 before submitting.',
      });
    }

    const doc = await OneOnOneCounselingLead.findOneAndUpdate(
      { _id: idParsed.leadId, formCompleted: { $ne: true } },
      { $set: validated.data },
      { new: true, runValidators: true, validateModifiedOnly: true }
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already completed. Please start from step 1.',
      });
    }

    const whatsappSubmit = await dispatchOneOnOneSubmitWhatsApp(doc);

    return res.status(200).json({
      success: true,
      message: 'Submitted successfully',
      data: mapLeadToDTO(doc.toObject()),
      whatsappSubmit,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[saveOneOnOneSection2]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/**
 * POST /api/one-on-one-counseling/section3 — save step 3 and complete booking
 */
exports.saveOneOnOneSection3 = async (req, res) => {
  try {
    const idParsed = parseLeadId(req.body || {});
    if (idParsed.error) {
      return res.status(400).json({ success: false, message: idParsed.error });
    }

    const validated = validateSection3Body(req.body || {});
    if (validated.error) {
      return res.status(400).json({ success: false, message: validated.error });
    }

    const existing = await OneOnOneCounselingLead.findOne({
      _id: idParsed.leadId,
      formCompleted: { $ne: true },
    }).lean();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already completed. Please start from step 1.',
      });
    }

    if (!existing.studentName || !existing.mobileNumber || !existing.currentClass) {
      return res.status(400).json({
        success: false,
        message: 'Please complete step 1 before submitting.',
      });
    }

    if (!existing.sessionAttendee || !existing.interestedBranch || !existing.collegeBudget) {
      return res.status(400).json({
        success: false,
        message: 'Please complete step 2 before submitting.',
      });
    }

    const doc = await OneOnOneCounselingLead.findOneAndUpdate(
      { _id: idParsed.leadId, formCompleted: { $ne: true } },
      { $set: validated.data },
      { new: true, runValidators: true, validateModifiedOnly: true }
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already completed. Please start from step 1.',
      });
    }

    const whatsappSubmit = await dispatchOneOnOneSubmitWhatsApp(doc);

    return res.status(200).json({
      success: true,
      message: 'Submitted successfully',
      data: mapLeadToDTO(doc.toObject()),
      whatsappSubmit,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[saveOneOnOneSection3]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/**
 * POST /api/one-on-one-counseling — public form submission (single-shot, backward compatible)
 */
exports.submitOneOnOneCounselingLead = async (req, res) => {
  try {
    const validated = validateSubmitBody(req.body || {});
    if (validated.error) {
      return res.status(400).json({ success: false, message: validated.error });
    }

    const doc = await OneOnOneCounselingLead.create(validated.data);

    await linkOneOnOneLeadToVisit(doc, req.body || {});

    const whatsappSubmit = await dispatchOneOnOneSubmitWhatsApp(doc);

    return res.status(201).json({
      success: true,
      message: 'Submitted successfully',
      data: mapLeadToDTO(doc.toObject()),
      whatsappSubmit,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitOneOnOneCounselingLead]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

function buildSearchQuery(q) {
  if (!q) return null;
  const term = String(q).trim();
  if (!term) return null;
  const digits = term.replace(/\D/g, '');
  const clauses = [
    { studentName: { $regex: term, $options: 'i' } },
    { parentName: { $regex: term, $options: 'i' } },
    { city: { $regex: term, $options: 'i' } },
    { entranceExamRank: { $regex: term, $options: 'i' } },
    { preferredTimeSlot: { $regex: term, $options: 'i' } },
  ];
  if (digits.length >= 6) {
    clauses.push({ mobileNumber: { $regex: digits } });
    clauses.push({ parentMobileNumber: { $regex: digits } });
  } else if (digits.length > 0) {
    clauses.push({ mobileNumber: { $regex: digits } });
    clauses.push({ parentMobileNumber: { $regex: digits } });
  }
  return { $or: clauses };
}

/**
 * GET /api/admin/one-on-one-counseling-leads
 */
exports.listOneOnOneCounselingLeads = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const match = {};
    const dateRange = buildDateRange(req.query.from, req.query.to);
    if (dateRange) match.createdAt = dateRange;

    const searchQuery = buildSearchQuery(req.query.q);
    if (searchQuery) Object.assign(match, searchQuery);

    const filterFields = [
      ['leadStatus', LEAD_STATUS_OPTIONS],
      ['currentClass', CURRENT_CLASS_OPTIONS],
      ['interestedBranch', INTERESTED_BRANCH_OPTIONS],
      ['collegeBudget', COLLEGE_BUDGET_OPTIONS],
      ['biggestConcern', BIGGEST_CONCERN_OPTIONS],
      ['preferredLanguage', PREFERRED_LANGUAGE_OPTIONS],
      ['sessionAttendee', SESSION_ATTENDEE_OPTIONS],
    ];

    const slotDateFilter =
      typeof req.query.preferredTimeSlotDate === 'string'
        ? req.query.preferredTimeSlotDate.trim()
        : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(slotDateFilter)) {
      match.preferredTimeSlotDate = slotDateFilter;
    }

    for (const [key, allowed] of filterFields) {
      const val = typeof req.query[key] === 'string' ? req.query[key].trim() : '';
      if (val && allowed.includes(val)) match[key] = val;
    }

    const leadRelevance =
      typeof req.query.leadRelevance === 'string' ? req.query.leadRelevance.trim() : '';
    const relevanceClause = buildLeadRelevanceMatchClause(
      ['relevant', 'irrelevant'].includes(leadRelevance) ? leadRelevance : ''
    );
    if (relevanceClause) {
      match.$and = match.$and || [];
      match.$and.push(relevanceClause);
    }

    applyUtmFilters(match, req.query);

    const bookingFilter =
      typeof req.query.bookingFilter === 'string' ? req.query.bookingFilter.trim() : '';
    if (bookingFilter === 'confirmed') {
      match.bookingConfirmed = true;
    } else if (bookingFilter === 'pending') {
      match.bookingConfirmed = { $ne: true };
      match.bookingStatus = 'Pending';
    } else if (bookingFilter === 'notBooked') {
      match.bookingConfirmed = { $ne: true };
      match.$or = [
        { bookingStatus: { $in: ['Not Booked', null] } },
        { bookingStatus: { $exists: false } },
      ];
    }
    if (req.query.bookingStatus && BOOKING_STATUS_OPTIONS.includes(req.query.bookingStatus)) {
      match.bookingStatus = req.query.bookingStatus;
    }
    if (req.query.parentAttendanceConfirmed === 'true') {
      match.parentAttendanceConfirmed = true;
    }
    if (req.query.whatsappConsent === 'true') {
      match.whatsappConsent = true;
    }
    if (mongoose.Types.ObjectId.isValid(req.query.selectedSlotId)) {
      match.selectedSlotId = req.query.selectedSlotId;
    }
    if (mongoose.Types.ObjectId.isValid(req.query.oneOnOneCounselorId)) {
      match.oneOnOneCounselorId = req.query.oneOnOneCounselorId;
    }
    const bookedSlotDate =
      typeof req.query.slotDate === 'string' ? req.query.slotDate.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(bookedSlotDate)) {
      const slotIds = await GuidanceSlot.find({ slotDate: bookedSlotDate }).distinct('_id');
      match.selectedSlotId = { $in: slotIds };
    }

    const [rows, total] = await Promise.all([
      OneOnOneCounselingLead.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      OneOnOneCounselingLead.countDocuments(match),
    ]);

    const slotIds = rows.filter((r) => r.selectedSlotId).map((r) => r.selectedSlotId);
    const counselorIds = rows.filter((r) => r.oneOnOneCounselorId).map((r) => r.oneOnOneCounselorId);
    const [slots, counselors] = await Promise.all([
      GuidanceSlot.find({ _id: { $in: slotIds } }).lean(),
      OneOnOneCounselor.find({ _id: { $in: counselorIds } }).select('name').lean(),
    ]);
    const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));
    const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));

    const enriched = rows.map((r) => {
      const slot = slotById[String(r.selectedSlotId)];
      const counselor = counselorById[String(r.oneOnOneCounselorId)];
      return {
        ...r,
        _slotSessionTitle: slot?.sessionTitle || '',
        _slotDate: slot?.slotDate || '',
        _slotTime: slot?.slotTime || '',
        _counselorName: counselor?.name || '',
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: enriched.map(mapLeadToDTO),
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    console.error('[listOneOnOneCounselingLeads]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/admin/one-on-one-counseling-leads/funnel-stats
 */
exports.getOneOnOneCounselingFunnelStats = async (req, res) => {
  try {
    const match = {};
    const dateRange = buildDateRange(req.query.from, req.query.to);
    if (dateRange) match.createdAt = dateRange;

    const contactedStatuses = ['Contacted', 'Demo Booked', 'Counseling Done', 'Converted'];
    const counselingDoneStatuses = ['Counseling Done', 'Converted'];

    const [
      totalLeads,
      formStarted,
      formCompleted,
      bookingConfirmed,
      bookingPending,
      contacted,
      counselingDone,
      converted,
      notInterested,
      whatsappConsent,
      parentAttendanceConfirmed,
    ] = await Promise.all([
      OneOnOneCounselingLead.countDocuments(match),
      OneOnOneCounselingLead.countDocuments({ ...match, currentStep: { $gte: 1 } }),
      OneOnOneCounselingLead.countDocuments({ ...match, formCompleted: true }),
      OneOnOneCounselingLead.countDocuments({ ...match, bookingConfirmed: true }),
      OneOnOneCounselingLead.countDocuments({ ...match, bookingStatus: 'Pending' }),
      OneOnOneCounselingLead.countDocuments({ ...match, leadStatus: { $in: contactedStatuses } }),
      OneOnOneCounselingLead.countDocuments({ ...match, leadStatus: { $in: counselingDoneStatuses } }),
      OneOnOneCounselingLead.countDocuments({ ...match, leadStatus: 'Converted' }),
      OneOnOneCounselingLead.countDocuments({ ...match, leadStatus: 'Not Interested' }),
      OneOnOneCounselingLead.countDocuments({ ...match, whatsappConsent: true }),
      OneOnOneCounselingLead.countDocuments({ ...match, parentAttendanceConfirmed: true }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalLeads,
        formStarted,
        formCompleted,
        bookingConfirmed,
        bookingPending,
        contacted,
        counselingDone,
        converted,
        notInterested,
        whatsappConsent,
        parentAttendanceConfirmed,
      },
    });
  } catch (err) {
    console.error('[getOneOnOneCounselingFunnelStats]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PATCH /api/admin/one-on-one-counseling-leads/:id
 */
exports.patchOneOnOneCounselingLead = async (req, res) => {
  try {
    const { id } = req.params;
    const leadStatus =
      typeof req.body?.leadStatus === 'string' ? req.body.leadStatus.trim() : '';

    if (!leadStatus) {
      return res.status(400).json({ success: false, message: 'leadStatus is required.' });
    }
    if (!LEAD_STATUS_OPTIONS.includes(leadStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid lead status.' });
    }

    const lead = await OneOnOneCounselingLead.findByIdAndUpdate(
      id,
      { leadStatus },
      { new: true, runValidators: true }
    ).lean();

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    return res.status(200).json({ success: true, data: mapLeadToDTO(lead) });
  } catch (err) {
    console.error('[patchOneOnOneCounselingLead]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
