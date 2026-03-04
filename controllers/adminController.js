const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const FormSubmission = require('../models/FormSubmission');
const AssessmentSubmission = require('../models/AssessmentSubmission');
const AssessmentSubmission2 = require('../models/AssessmentSubmission2');
const AssessmentSubmission3 = require('../models/AssessmentSubmission3');
const SlotConfig = require('../models/SlotConfig');
const SlotDateOverride = require('../models/SlotDateOverride');
const MeetingAttendance = require('../models/MeetingAttendance');
const TrainingFeedback = require('../models/TrainingFeedback');
const Counsellor = require('../models/Counsellor');
const { getISTCalendarDateUTC, getISTDayRangeFromString } = require('../utils/dateHelpers');

function normalizePhoneTo10(value) {
  if (value == null) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}
const { getQuestionResults, CORRECT_ANSWERS, CORRECT_ANSWERS_2, CORRECT_ANSWERS_3 } = require('./assessmentController');

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || '24h';

// Sample hardcoded dev credentials (only when NODE_ENV !== 'production' or ALLOW_DEV_ADMIN_LOGIN=true)
const DEV_SAMPLE_USERNAME = 'admin';
const DEV_SAMPLE_PASSWORD = 'admin123';

const ALL_SLOT_IDS = [
  'MONDAY_7PM', 'TUESDAY_7PM', 'WEDNESDAY_7PM', 'THURSDAY_7PM',
  'FRIDAY_7PM', 'SATURDAY_7PM', 'SUNDAY_3PM', 'SUNDAY_11AM',
  'MONDAY_6PM', 'TUESDAY_6PM', 'WEDNESDAY_6PM', 'THURSDAY_6PM',
  'FRIDAY_6PM', 'SATURDAY_6PM', 'SUNDAY_6PM'
];

/** Lead is "slot booked" if any of: isRegistered, step3Data.selectedSlot, or root selectedSlot is set. */
const SLOT_BOOKED_CONDITION = {
  $or: [
    { isRegistered: true },
    { 'step3Data.selectedSlot': { $exists: true, $nin: [null, ''] } },
    { selectedSlot: { $exists: true, $nin: [null, ''] } }
  ]
};

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function formatSlotLabelForDisplay(slotId) {
  if (!slotId || typeof slotId !== 'string') return slotId || '';
  const match = slotId.match(/^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)_(7PM|11AM|3PM|6PM)$/i);
  if (match) {
    const dayShort = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun' };
    return `${dayShort[match[1].toUpperCase()] || match[1]} ${match[2]}`;
  }
  return slotId;
}

function isDevAdminAllowed() {
  if (process.env.ALLOW_DEV_ADMIN_LOGIN === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ success: false, message: 'username is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'password is required' });
    }
    if (!JWT_SECRET) {
      console.error('[Admin] ADMIN_JWT_SECRET not set');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    let admin = await Admin.findOne({ username: username.trim().toLowerCase() });

    // Development only: if sample credentials are used and no user "admin" exists, create sample admin
    if (!admin && isDevAdminAllowed()) {
      const isSampleCreds =
        username.trim().toLowerCase() === DEV_SAMPLE_USERNAME &&
        password === DEV_SAMPLE_PASSWORD;
      if (isSampleCreds) {
        try {
          admin = await Admin.create({
            username: DEV_SAMPLE_USERNAME,
            password: DEV_SAMPLE_PASSWORD,
            name: 'Admin',
          });
          console.log('[Admin] Sample dev admin created (username: admin, password: admin123)');
        } catch (createErr) {
          console.error('[Admin] Sample admin create failed:', createErr);
          return res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : createErr.message,
          });
        }
      }
    }

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    let valid = false;
    try {
      valid = await admin.comparePassword(password);
    } catch (compareErr) {
      console.error('[Admin login] comparePassword failed:', compareErr);
    }
    // Development only: if user "admin" exists but password is wrong, reset to admin123 so sample creds work
    if (!valid && isDevAdminAllowed() &&
        username.trim().toLowerCase() === DEV_SAMPLE_USERNAME && password === DEV_SAMPLE_PASSWORD) {
      try {
        const hash = await bcrypt.hash(DEV_SAMPLE_PASSWORD, 10);
        await Admin.findByIdAndUpdate(admin._id, {
          $set: { password: hash, updatedAt: new Date() },
        });
        valid = true;
        console.log('[Admin] Dev: password reset to admin123 for user admin');
      } catch (resetErr) {
        console.error('[Admin] Dev password reset failed:', resetErr);
      }
    }
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { adminId: admin._id.toString() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.status(200).json({
      success: true,
      token,
      user: { id: admin._id, username: admin.username }
    });
  } catch (error) {
    console.error('[Admin login] Error:', error);
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      console.error('[Admin login] Stack:', error.stack);
    }
    const message =
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong.'
        : (error.message || String(error));
    return res.status(500).json({ success: false, message });
  }
};

function mapLeadToDTO(sub) {
  const step2 = sub.step2Data || {};
  const step3 = sub.step3Data || {};
  const post = sub.postRegistrationData || {};
  return {
    id: sub._id,
    fullName: sub.fullName,
    phone: sub.phone,
    occupation: sub.occupation,
    otpVerified: !!step2.otpVerified,
    step2CompletedAt: step2.step2CompletedAt || null,
    slotBooked: !!(sub.isRegistered || step3.selectedSlot || sub.selectedSlot),
    selectedSlot: step3.selectedSlot || sub.selectedSlot || null,
    slotDate: step3.slotDate || null,
    step3CompletedAt: step3.step3CompletedAt || null,
    isRegistered: !!sub.isRegistered,
    registeredAt: sub.registeredAt || null,
    currentStep: sub.currentStep,
    applicationStatus: sub.applicationStatus,
    email: sub.email || post.email || null,
    interestLevel: sub.interestLevel || post.interestLevel || null,
    postRegistrationCompletedAt: post.completedAt || null,
    step1CompletedAt: (sub.step1Data || {}).step1CompletedAt || null,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    utm_source: sub.utm_source || null,
    utm_medium: sub.utm_medium || null,
    utm_campaign: sub.utm_campaign || null,
    utm_content: sub.utm_content || null,
    adminNotes: sub.adminNotes || null,
    adminNotesUpdatedAt: sub.adminNotesUpdatedAt || null,
    leadStatus: sub.leadStatus || null,
    leadDescription: sub.leadDescription || null
  };
}

const LEAD_STATUS_VALUES = ['Connected', 'Not Connected', 'Call Back Later', 'Not Interested', 'Interested'];

exports.getLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Lead ID is required' });
    }
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const sub = await FormSubmission.findById(id).lean();
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    return res.status(200).json({ success: true, data: mapLeadToDTO(sub) });
  } catch (error) {
    console.error('[getLeadById] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateLeadNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes, leadStatus, leadDescription } = req.body || {};
    if (!id) {
      return res.status(400).json({ success: false, message: 'Lead ID is required' });
    }
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const $set = {};
    if (adminNotes !== undefined) {
      const notes = typeof adminNotes === 'string' ? adminNotes.trim().slice(0, 2000) : '';
      $set.adminNotes = notes;
      $set.adminNotesUpdatedAt = new Date();
    }
    if (leadStatus !== undefined) {
      const status = typeof leadStatus === 'string' ? leadStatus.trim() : '';
      if (status && !LEAD_STATUS_VALUES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid leadStatus' });
      }
      $set.leadStatus = status || null;
    }
    if (leadDescription !== undefined) {
      const desc = typeof leadDescription === 'string' ? leadDescription.trim().slice(0, 2000) : '';
      $set.leadDescription = desc || null;
    }
    const updated = await FormSubmission.findByIdAndUpdate(
      id,
      Object.keys($set).length ? { $set } : {},
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    return res.status(200).json({
      success: true,
      data: mapLeadToDTO(updated)
    });
  } catch (error) {
    console.error('[updateLeadNotes] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

// Stats are scoped to the selected date range (from/to query). All FormSubmission counts use this filter.
function buildStatsDateFilter(fromStr, toStr) {
  const fromDate = fromStr ? new Date(fromStr + 'T00:00:00.000Z') : null;
  const toDate = toStr ? new Date(toStr + 'T23:59:59.999Z') : null;
  const fromValid = fromDate && !Number.isNaN(fromDate.getTime());
  const toValid = toDate && !Number.isNaN(toDate.getTime());
  if (fromValid && toValid) {
    return { createdAt: { $gte: fromDate, $lte: toDate } };
  }
  const defaultTo = new Date();
  defaultTo.setUTCHours(23, 59, 59, 999);
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  defaultFrom.setUTCHours(0, 0, 0, 0);
  return { createdAt: { $gte: defaultFrom, $lte: defaultTo } };
}

exports.getAdminStats = async (req, res) => {
  try {
    const fromStr = (req.query.from || '').trim();
    const toStr = (req.query.to || '').trim();
    const dateFilter = buildStatsDateFilter(fromStr, toStr);

    const [
      total,
      inProgress,
      registered,
      completed,
      otpVerified,
      slotBooked,
      otpVerifiedSlotBooked,
      slotAggregation,
      signupsByDay,
      meetingAttendeePhones,
      slotBookedLeadsPhones,
      assessment1Phones,
      assessment2Phones,
      assessment3Phones,
      activationFormMobilePhones,
      activationFormWhatsappPhones,
      counsellorPhones
    ] = await Promise.all([
      FormSubmission.countDocuments(dateFilter),
      FormSubmission.countDocuments({ $and: [dateFilter, { applicationStatus: 'in_progress' }] }),
      FormSubmission.countDocuments({ $and: [dateFilter, { applicationStatus: 'registered' }] }),
      FormSubmission.countDocuments({ $and: [dateFilter, { applicationStatus: 'completed' }] }),
      FormSubmission.countDocuments({ $and: [dateFilter, { 'step2Data.otpVerified': true }] }),
      FormSubmission.countDocuments({ $and: [dateFilter, SLOT_BOOKED_CONDITION] }),
      FormSubmission.countDocuments({
        $and: [dateFilter, { 'step2Data.otpVerified': true }, SLOT_BOOKED_CONDITION]
      }),
      FormSubmission.aggregate([
        { $match: { $and: [dateFilter, SLOT_BOOKED_CONDITION] } },
        { $addFields: { _slotId: { $ifNull: ['$step3Data.selectedSlot', '$selectedSlot'] } } },
        { $match: { _slotId: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$_slotId', count: { $sum: 1 } } }
      ]),
      FormSubmission.aggregate([
        { $match: dateFilter },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      MeetingAttendance.aggregate([{ $group: { _id: '$mobileNumber' } }]),
      FormSubmission.find({ $and: [dateFilter, SLOT_BOOKED_CONDITION] }).select('phone').lean(),
      AssessmentSubmission.distinct('phone'),
      AssessmentSubmission2.distinct('phone'),
      AssessmentSubmission3.distinct('phone'),
      TrainingFeedback.distinct('mobileNumber'),
      TrainingFeedback.distinct('whatsappNumber'),
      Counsellor.distinct('phone')
    ]);

    const attendeePhonesSet = new Set(
      (meetingAttendeePhones || []).map((r) => normalizePhoneTo10(r._id)).filter(Boolean)
    );
    const demoAttended = (slotBookedLeadsPhones || []).filter((lead) =>
      attendeePhonesSet.has(normalizePhoneTo10(lead.phone))
    ).length;
    const demoNotAttended = Math.max(0, slotBooked - demoAttended);
    const otpNotVerified = Math.max(0, total - otpVerified);
    const otpVerifiedSlotNotBooked = Math.max(0, otpVerified - otpVerifiedSlotBooked);

    const assessmentPhonesSet = new Set(
      [
        ...(assessment1Phones || []),
        ...(assessment2Phones || []),
        ...(assessment3Phones || [])
      ].map(normalizePhoneTo10).filter(Boolean)
    );
    const demoAttendedLeads = (slotBookedLeadsPhones || []).filter((lead) =>
      attendeePhonesSet.has(normalizePhoneTo10(lead.phone))
    );
    const assessmentWritten = demoAttendedLeads.filter((lead) =>
      assessmentPhonesSet.has(normalizePhoneTo10(lead.phone))
    ).length;
    const assessmentNotWritten = Math.max(0, demoAttended - assessmentWritten);

    const activationFormPhonesSet = new Set(
      [
        ...(activationFormMobilePhones || []),
        ...(activationFormWhatsappPhones || [])
      ].map(normalizePhoneTo10).filter(Boolean)
    );
    const assessmentWrittenLeads = demoAttendedLeads.filter((lead) =>
      assessmentPhonesSet.has(normalizePhoneTo10(lead.phone))
    );
    const activationFormCompleted = assessmentWrittenLeads.filter((lead) =>
      activationFormPhonesSet.has(normalizePhoneTo10(lead.phone))
    ).length;
    const activationFormNotDone = Math.max(0, assessmentWritten - activationFormCompleted);

    const counsellorPhonesSet = new Set(
      (counsellorPhones || []).map(normalizePhoneTo10).filter(Boolean)
    );
    const counsellorDashboardLoggedIn = [...activationFormPhonesSet].filter((phone) =>
      counsellorPhonesSet.has(phone)
    ).length;
    const counsellorDashboardNotLoggedIn = Math.max(0, activationFormCompleted - counsellorDashboardLoggedIn);

    const bySlot = (slotAggregation || []).reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});
    const signupsOverTime = (signupsByDay || []).map((d) => ({ date: d._id, count: d.count }));
    // Placeholder: pageVisited mirrors total leads until dedicated visit tracking is added.
    const pageVisited = total;

    return res.status(200).json({
      success: true,
      data: {
        total,
        inProgress,
        registered,
        completed,
        otpVerified,
        otpNotVerified,
        slotBooked,
        otpVerifiedSlotBooked,
        otpVerifiedSlotNotBooked,
        demoAttended,
        demoNotAttended,
        assessmentWritten,
        assessmentNotWritten,
        activationFormCompleted,
        activationFormNotDone,
        counsellorDashboardLoggedIn,
        counsellorDashboardNotLoggedIn,
        pageVisited,
        bySlot,
        signupsOverTime
      }
    });
  } catch (error) {
    console.error('[getAdminStats] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

function escapeCsvCell(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exports.exportLeads = async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const selectedSlot = (req.query.selectedSlot || '').trim();
    const utm_content = (req.query.utm_content || '').trim();

    const filter = {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }
    if (selectedSlot && ALL_SLOT_IDS.includes(selectedSlot)) {
      filter.$or = [{ 'step3Data.selectedSlot': selectedSlot }, { selectedSlot: selectedSlot }];
    }
    if (utm_content) {
      filter.utm_content = utm_content;
    }

    const submissions = await FormSubmission.find(filter).sort({ createdAt: -1 }).lean();
    const rows = submissions.map((sub) => {
      const dto = mapLeadToDTO(sub);
      return [
        dto.id,
        dto.fullName,
        dto.phone,
        dto.occupation,
        dto.otpVerified ? 'Yes' : 'No',
        dto.slotBooked ? 'Yes' : 'No',
        dto.selectedSlot || '',
        dto.slotDate ? dto.slotDate.toISOString() : '',
        dto.applicationStatus || '',
        dto.currentStep ?? '',
        dto.email || '',
        dto.interestLevel || '',
        dto.utm_source || '',
        dto.utm_medium || '',
        dto.utm_campaign || '',
        dto.utm_content || '',
        dto.adminNotes || '',
        dto.leadStatus || '',
        dto.leadDescription || '',
        dto.createdAt ? dto.createdAt.toISOString() : '',
        dto.updatedAt ? dto.updatedAt.toISOString() : ''
      ];
    });

    const header = [
      'ID', 'Full Name', 'Phone', 'Occupation', 'OTP Verified', 'Slot Booked',
      'Selected Slot', 'Slot Date', 'Status', 'Step', 'Email', 'Interest',
      'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content (Influencer)',
      'Admin Notes', 'Lead Status', 'Lead Description', 'Created', 'Updated'
    ];
    const csvLines = [header.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))];
    const csv = csvLines.join('\r\n');

    const filename = `guidexpert-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('[exportLeads] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getAdminLeads = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const applicationStatus = req.query.applicationStatus; // in_progress | registered | completed
    const otpVerified = req.query.otpVerified; // true | false (string)
    const slotBooked = req.query.slotBooked; // true | false (string)
    const selectedSlot = (req.query.selectedSlot || '').trim();
    const q = (req.query.q || '').trim();
    const utm_content = (req.query.utm_content || '').trim();

    const andConditions = [];

    if (utm_content) {
      andConditions.push({ utm_content });
    }
    if (applicationStatus && ['in_progress', 'registered', 'completed'].includes(applicationStatus)) {
      andConditions.push({ applicationStatus });
    }
    if (otpVerified === 'true') {
      andConditions.push({ 'step2Data.otpVerified': true });
    } else if (otpVerified === 'false') {
      andConditions.push({
        $or: [{ 'step2Data.otpVerified': { $ne: true } }, { step2Data: { $exists: false } }]
      });
    }
    if (slotBooked === 'true') {
      andConditions.push(SLOT_BOOKED_CONDITION);
    } else if (slotBooked === 'false') {
      andConditions.push({
        $and: [
          { isRegistered: { $ne: true } },
          { $or: [{ 'step3Data.selectedSlot': null }, { 'step3Data.selectedSlot': { $exists: false } }, { 'step3Data.selectedSlot': '' }] },
          { $or: [{ selectedSlot: null }, { selectedSlot: { $exists: false } }, { selectedSlot: '' }] }
        ]
      });
    }
    if (selectedSlot && ALL_SLOT_IDS.includes(selectedSlot)) {
      andConditions.push({
        $or: [{ 'step3Data.selectedSlot': selectedSlot }, { selectedSlot: selectedSlot }]
      });
    }
    const slotDate = (req.query.slotDate || '').trim();
    const istDayRange = getISTDayRangeFromString(slotDate);
    if (istDayRange) {
      const { start, end } = istDayRange;
      console.log('[getAdminLeads] Date filter:', { slotDate, start: start.toISOString(), end: end.toISOString() });
      // Only show leads with a slot booked on this specific date (IST calendar day)
      andConditions.push({
        'step3Data.slotDate': { $gte: start, $lt: end }
      });
      // Ensure they have a selected slot (step3 or root)
      andConditions.push({
        $or: [
          { 'step3Data.selectedSlot': { $exists: true, $nin: [null, ''] } },
          { selectedSlot: { $exists: true, $nin: [null, ''] } }
        ]
      });
    }
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        $or: [
          { fullName: { $regex: safe, $options: 'i' } },
          { phone: { $regex: safe } },
          { email: { $regex: safe, $options: 'i' } }
        ]
      });
    }

    const filter = andConditions.length > 0 ? { $and: andConditions } : {};

    console.log('[getAdminLeads] Query params:', { page, limit, slotDate, slotBooked, selectedSlot });
    console.log('[getAdminLeads] Filter:', JSON.stringify(filter, null, 2));

    const skip = (page - 1) * limit;
    const [submissions, total] = await Promise.all([
      FormSubmission.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      FormSubmission.countDocuments(filter)
    ]);
    
    console.log('[getAdminLeads] Found', total, 'leads');
    // Debug: log first few slotDates to verify filtering
    if (submissions.length > 0) {
      console.log('[getAdminLeads] Sample slotDates:', submissions.slice(0, 5).map(s => ({
        name: s.fullName,
        slotDate: s.step3Data?.slotDate,
        slotDateISO: s.step3Data?.slotDate ? new Date(s.step3Data.slotDate).toISOString() : null,
        selectedSlot: s.step3Data?.selectedSlot
      })));
    }

    const data = submissions.map((sub) => mapLeadToDTO(sub));
    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('[getAdminLeads] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getSlotConfigs = async (req, res) => {
  try {
    const [configs, bookingCounts] = await Promise.all([
      SlotConfig.find({ slotId: { $in: ALL_SLOT_IDS } }).lean(),
      FormSubmission.aggregate([
        { $match: { 'step3Data.selectedSlot': { $exists: true, $ne: null } } },
        { $group: { _id: '$step3Data.selectedSlot', count: { $sum: 1 } } }
      ])
    ]);

    const configMap = Object.fromEntries(configs.map((c) => [c.slotId, c.enabled]));
    const countMap = Object.fromEntries((bookingCounts || []).map((c) => [c._id, c.count]));

    const slots = ALL_SLOT_IDS.map((slotId) => {
      const enabled = configMap[slotId];
      return {
        slotId,
        enabled: enabled !== undefined ? enabled : true,
        bookedCount: countMap[slotId] ?? 0
      };
    });

    for (const slotId of ALL_SLOT_IDS) {
      if (configMap[slotId] === undefined) {
        await SlotConfig.findOneAndUpdate(
          { slotId },
          { $set: { enabled: true, updatedAt: new Date() } },
          { upsert: true }
        );
      }
    }

    return res.status(200).json({ success: true, data: { slots } });
  } catch (error) {
    console.error('[getSlotConfigs] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/slots/for-date?date=YYYY-MM-DD
 * Returns slots available on that IST calendar date (day-of-week match + SlotConfig + SlotDateOverride).
 */
exports.getSlotsForDate = async (req, res) => {
  try {
    const dateStr = (req.query.date || '').trim();
    const istDayRange = getISTDayRangeFromString(dateStr);
    if (!istDayRange) {
      return res.status(200).json({ success: true, data: { slots: [] } });
    }
    const { start } = istDayRange;
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const istDayOfWeek = new Date(start.getTime() + IST_OFFSET_MS).getUTCDay();

    const candidateSlotIds = ALL_SLOT_IDS.filter((slotId) => {
      const dayName = slotId.split('_')[0];
      return DAY_NAMES.indexOf(dayName) === istDayOfWeek;
    });

    const [configs, overrides] = await Promise.all([
      SlotConfig.find({ slotId: { $in: candidateSlotIds } }).lean(),
      SlotDateOverride.find({ date: start, slotId: { $in: candidateSlotIds } }).lean()
    ]);

    const configMap = Object.fromEntries(configs.map((c) => [c.slotId, c.enabled]));
    const overrideMap = Object.fromEntries(overrides.map((o) => [o.slotId, o.enabled]));

    const slots = candidateSlotIds
      .filter((slotId) => {
        const override = overrideMap[slotId];
        const config = configMap[slotId];
        const enabled = override !== undefined ? override : (config !== undefined ? config : true);
        return enabled;
      })
      .map((slotId) => ({ slotId, label: formatSlotLabelForDisplay(slotId) }));

    return res.status(200).json({ success: true, data: { slots } });
  } catch (error) {
    console.error('[getSlotsForDate] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateSlotConfig = async (req, res) => {
  try {
    const { slotId } = req.params;
    const { enabled } = req.body || {};

    if (!slotId || !ALL_SLOT_IDS.includes(slotId)) {
      return res.status(400).json({ success: false, message: 'Invalid slot ID' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
    }

    const config = await SlotConfig.findOneAndUpdate(
      { slotId },
      { $set: { enabled, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      data: { slotId: config.slotId, enabled: config.enabled }
    });
  } catch (error) {
    console.error('[updateSlotConfig] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/slots/booking-counts?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns booking counts per (date, slotId) in the given range (IST calendar date).
 */
exports.getSlotBookingCounts = async (req, res) => {
  try {
    const fromStr = (req.query.from || '').trim();
    const toStr = (req.query.to || '').trim();
    if (!fromStr || !toStr) {
      return res.status(400).json({ success: false, message: 'Query params from and to (YYYY-MM-DD) are required' });
    }
    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid from or to date' });
    }

    const pipeline = [
      {
        $match: {
          ...SLOT_BOOKED_CONDITION,
          'step3Data.slotDate': { $exists: true, $ne: null }
        }
      },
      {
        $addFields: {
          slotDateIST: {
            $dateToString: {
              date: '$step3Data.slotDate',
              format: '%Y-%m-%d',
              timezone: 'Asia/Kolkata'
            }
          },
          _slotId: { $ifNull: ['$step3Data.selectedSlot', '$selectedSlot'] }
        }
      },
      {
        $match: {
          slotDateIST: { $gte: fromStr, $lte: toStr },
          _slotId: { $exists: true, $nin: [null, ''] }
        }
      },
      {
        $group: {
          _id: {
            date: '$slotDateIST',
            slotId: '$_slotId'
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          date: '$_id.date',
          slotId: '$_id.slotId',
          count: 1
        }
      }
    ];

    const rawCounts = await FormSubmission.aggregate(pipeline);

    const counts = rawCounts.map((item) => {
      let dateStr = item.date;
      if (typeof dateStr === 'string' && dateStr.length >= 10) {
        dateStr = dateStr.slice(0, 10);
      } else if (dateStr instanceof Date || (typeof dateStr === 'string' && dateStr)) {
        dateStr = new Date(dateStr).toISOString().slice(0, 10);
      }
      return { date: dateStr, slotId: item.slotId, count: item.count };
    });

    return res.status(200).json({ success: true, data: { counts } });
  } catch (error) {
    console.error('[getSlotBookingCounts] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/slots/overrides?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns date-specific overrides in the given range (for month calendar).
 */
exports.getSlotOverrides = async (req, res) => {
  try {
    const fromStr = (req.query.from || '').trim();
    const toStr = (req.query.to || '').trim();
    if (!fromStr || !toStr) {
      return res.status(400).json({ success: false, message: 'Query params from and to (YYYY-MM-DD) are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      return res.status(400).json({ success: false, message: 'Invalid from or to date format (use YYYY-MM-DD)' });
    }
    const fromDate = getISTCalendarDateUTC(new Date(fromStr + 'T12:00:00.000Z'));
    const endOfTo = new Date(getISTCalendarDateUTC(new Date(toStr + 'T12:00:00.000Z')).getTime() + 24 * 60 * 60 * 1000);

    const overrides = await SlotDateOverride.find({
      date: { $gte: fromDate, $lt: endOfTo }
    }).lean();

    const data = overrides.map((o) => ({
      date: new Date(o.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      slotId: o.slotId,
      enabled: o.enabled
    }));

    return res.status(200).json({ success: true, data: { overrides: data } });
  } catch (error) {
    console.error('[getSlotOverrides] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PUT /admin/slots/overrides
 * Body: { date: "YYYY-MM-DD", slotId: "MONDAY_7PM", enabled: true }
 * Upserts override for (date, slotId).
 */
exports.setSlotOverride = async (req, res) => {
  try {
    const { date: dateStr, slotId, enabled } = req.body || {};
    if (!dateStr || typeof dateStr !== 'string') {
      return res.status(400).json({ success: false, message: 'date (YYYY-MM-DD) is required' });
    }
    if (!slotId || !ALL_SLOT_IDS.includes(slotId)) {
      return res.status(400).json({ success: false, message: 'Invalid slotId' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, message: 'Invalid date format (use YYYY-MM-DD)' });
    }
    const dateOnly = getISTCalendarDateUTC(new Date(dateStr + 'T12:00:00.000Z'));

    const override = await SlotDateOverride.findOneAndUpdate(
      { date: dateOnly, slotId },
      { $set: { enabled, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        date: new Date(override.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        slotId: override.slotId,
        enabled: override.enabled
      }
    });
  } catch (error) {
    console.error('[setSlotOverride] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/assessment-submissions
 * Query: page, limit
 * Returns list of assessment submissions with score for admin panel.
 */
exports.getAssessmentSubmissions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      AssessmentSubmission.find({})
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .select('fullName phone score maxScore submittedAt'),
      AssessmentSubmission.countDocuments({})
    ]);

    return res.status(200).json({
      success: true,
      submissions,
      total
    });
  } catch (error) {
    console.error('[getAssessmentSubmissions] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/assessment-2-submissions
 * Query: page, limit
 * Returns list of assessment 2 submissions with score for admin panel.
 */
exports.getAssessment2Submissions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      AssessmentSubmission2.find({})
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .select('fullName phone score maxScore submittedAt'),
      AssessmentSubmission2.countDocuments({})
    ]);

    return res.status(200).json({
      success: true,
      submissions,
      total
    });
  } catch (error) {
    console.error('[getAssessment2Submissions] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/assessment-submissions/:id
 * Returns one assessment submission with questionResults for admin detail view.
 */
exports.getAssessmentSubmissionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Submission id is required.' });
    }
    const submission = await AssessmentSubmission.findById(id)
      .select('fullName phone score maxScore submittedAt answers')
      .lean();
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    const questionResults = getQuestionResults(submission.answers || {}, CORRECT_ANSWERS);
    return res.status(200).json({
      success: true,
      submission: { ...submission, questionResults }
    });
  } catch (error) {
    console.error('[getAssessmentSubmissionById] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/assessment-2-submissions/:id
 * Returns one assessment 2 submission with questionResults for admin detail view.
 */
exports.getAssessment2SubmissionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Submission id is required.' });
    }
    const submission = await AssessmentSubmission2.findById(id)
      .select('fullName phone score maxScore submittedAt answers')
      .lean();
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    const questionResults = getQuestionResults(submission.answers || {}, CORRECT_ANSWERS_2);
    return res.status(200).json({
      success: true,
      submission: { ...submission, questionResults }
    });
  } catch (error) {
    console.error('[getAssessment2SubmissionById] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/assessment-3-submissions
 * Returns list of assessment 3 submissions with score for admin panel.
 */
exports.getAssessment3Submissions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      AssessmentSubmission3.find({})
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .select('fullName phone score maxScore submittedAt'),
      AssessmentSubmission3.countDocuments({})
    ]);

    return res.status(200).json({
      success: true,
      submissions,
      total
    });
  } catch (error) {
    console.error('[getAssessment3Submissions] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /admin/assessment-3-submissions/:id
 * Returns one assessment 3 submission with questionResults for admin detail view.
 */
exports.getAssessment3SubmissionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Submission id is required.' });
    }
    const submission = await AssessmentSubmission3.findById(id)
      .select('fullName phone score maxScore submittedAt answers')
      .lean();
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    const questionResults = getQuestionResults(submission.answers || {}, CORRECT_ANSWERS_3);
    return res.status(200).json({
      success: true,
      submission: { ...submission, questionResults }
    });
  } catch (error) {
    console.error('[getAssessment3SubmissionById] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
