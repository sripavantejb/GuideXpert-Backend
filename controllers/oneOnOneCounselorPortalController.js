const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const {
  NAT_CHANNEL_OPTIONS,
  NAT_CAMPAIGN_OPTIONS,
  NAT_LANGUAGE_OPTIONS,
  NAT_COUNSELLOR_BY_OPTIONS,
  NAT_CBA_NAME_OPTIONS,
  NAT_SESSION_STAGE_OPTIONS,
} = require('../constants/natFollowUp');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const { COUNSELOR_BOOKING_STATUS_OPTIONS } = require('../constants/guidanceBooking');
const { getOneOnOneCounselorJwtSecret } = require('../middleware/requireOneOnOneCounselor');
const { mapLeadBookingDTO } = require('../services/guidanceBookingService');

const JWT_EXPIRES_IN = process.env.ONE_ON_ONE_COUNSELOR_JWT_EXPIRES_IN || '7d';

function mapCounselorUser(doc) {
  return {
    id: String(doc._id),
    oneOnOneCounselorId: String(doc._id),
    name: doc.name,
    email: doc.email,
    mobile: doc.mobile || '',
    profileImage: doc.profileImage || '',
    collegeName: doc.collegeName || '',
    designation: doc.designation || '',
    bio: doc.bio || '',
    role: doc.role || 'oneOnOneCounselor',
    isActive: doc.isActive !== false,
  };
}

function mapSlotRow(doc) {
  return {
    id: String(doc._id),
    sessionTitle: doc.sessionTitle,
    slotDate: doc.slotDate,
    slotTime: doc.slotTime,
    maxBookings: doc.maxBookings,
    currentBookings: doc.currentBookings,
    isActive: doc.isActive !== false,
    isFull: doc.currentBookings >= doc.maxBookings,
  };
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailVal = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!emailVal || !emailVal.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const secret = getOneOnOneCounselorJwtSecret();
    if (!secret) {
      return res.status(500).json({ success: false, message: 'Counselor login is not configured.' });
    }

    const counselor = await OneOnOneCounselor.findOne({ email: emailVal }).select('+password');
    if (!counselor) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    if (!counselor.isActive) {
      return res.status(403).json({ success: false, message: 'Account is inactive. Contact admin.' });
    }
    const ok = await counselor.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { oneOnOneCounselorId: String(counselor._id), role: 'oneOnOneCounselor' },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      success: true,
      data: { token, user: mapCounselorUser(counselor) },
    });
  } catch (err) {
    console.error('[oneOnOneCounselorLogin]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.me = async (req, res) => {
  return res.status(200).json({ success: true, data: mapCounselorUser(req.oneOnOneCounselor) });
};

exports.listMySlots = async (req, res) => {
  try {
    const counselorId = req.oneOnOneCounselor._id;
    const slots = await GuidanceSlot.find({ oneOnOneCounselorId: counselorId })
      .sort({ slotDate: -1, slotTime: 1 })
      .lean();
    return res.status(200).json({ success: true, data: slots.map(mapSlotRow) });
  } catch (err) {
    console.error('[listMySlots]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.toggleMySlot = async (req, res) => {
  try {
    const { id } = req.params;
    const counselorId = req.oneOnOneCounselor._id;
    const slot = await GuidanceSlot.findOne({ _id: id, oneOnOneCounselorId: counselorId });
    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found or not assigned to you.' });
    }
    slot.isActive = !slot.isActive;
    await slot.save();
    return res.status(200).json({ success: true, data: mapSlotRow(slot.toObject()) });
  } catch (err) {
    console.error('[toggleMySlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.listMyBookings = async (req, res) => {
  try {
    const counselorId = req.oneOnOneCounselor._id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const match = { oneOnOneCounselorId: counselorId, bookingConfirmed: true };
    if (mongoose.Types.ObjectId.isValid(req.query.selectedSlotId)) {
      match.selectedSlotId = req.query.selectedSlotId;
    }

    const [rows, total] = await Promise.all([
      OneOnOneCounselingLead.find(match)
        .sort({ bookingConfirmedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OneOnOneCounselingLead.countDocuments(match),
    ]);

    const slotIds = rows.map((r) => r.selectedSlotId).filter(Boolean);
    const slots = await GuidanceSlot.find({ _id: { $in: slotIds } }).lean();
    const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));
    const counselor = req.oneOnOneCounselor.toObject
      ? req.oneOnOneCounselor.toObject()
      : req.oneOnOneCounselor;

    return res.status(200).json({
      success: true,
      data: rows.map((r) => mapLeadBookingDTO(r, slotById[String(r.selectedSlotId)], counselor)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[listMyBookings]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.patchBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const bookingStatus =
      typeof req.body?.bookingStatus === 'string' ? req.body.bookingStatus.trim() : '';
    if (!COUNSELOR_BOOKING_STATUS_OPTIONS.includes(bookingStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid booking status.' });
    }

    const counselorId = req.oneOnOneCounselor._id;
    const lead = await OneOnOneCounselingLead.findOne({
      _id: id,
      oneOnOneCounselorId: counselorId,
      bookingConfirmed: true,
    });
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    lead.bookingStatus = bookingStatus;
    lead.attendanceStatus = bookingStatus;
    await lead.save();

    const slot = lead.selectedSlotId
      ? await GuidanceSlot.findById(lead.selectedSlotId).lean()
      : null;

    return res.status(200).json({
      success: true,
      data: mapLeadBookingDTO(lead.toObject(), slot, req.oneOnOneCounselor),
    });
  } catch (err) {
    console.error('[patchBookingStatus]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.patchBookingRemarks = async (req, res) => {
  try {
    const { id } = req.params;
    const remarks =
      typeof req.body?.counselorRemarks === 'string'
        ? req.body.counselorRemarks.trim().slice(0, 2000)
        : '';

    const counselorId = req.oneOnOneCounselor._id;
    const lead = await OneOnOneCounselingLead.findOne({
      _id: id,
      oneOnOneCounselorId: counselorId,
      bookingConfirmed: true,
    });
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    lead.counselorRemarks = remarks;
    await lead.save();

    const slot = lead.selectedSlotId
      ? await GuidanceSlot.findById(lead.selectedSlotId).lean()
      : null;

    return res.status(200).json({
      success: true,
      data: mapLeadBookingDTO(lead.toObject(), slot, req.oneOnOneCounselor),
    });
  } catch (err) {
    console.error('[patchBookingRemarks]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const counselor = req.oneOnOneCounselor;
    const body = req.body || {};
    if (typeof body.profileImage === 'string') counselor.profileImage = body.profileImage.trim().slice(0, 500);
    if (typeof body.bio === 'string') counselor.bio = body.bio.trim().slice(0, 2000);
    if (typeof body.designation === 'string') {
      counselor.designation = body.designation.trim().slice(0, 120);
    }
    if (body.password && typeof body.password === 'string' && body.password.length >= 6) {
      counselor.password = body.password;
    }
    await counselor.save();
    return res.status(200).json({ success: true, data: mapCounselorUser(counselor) });
  } catch (err) {
    console.error('[updateMyProfile]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

function buildNatFieldBreakdown(leads, fieldKey, options) {
  const labels = [...options.filter(Boolean), 'Not set'];
  return labels.map((label) => {
    const matched = leads.filter((lead) => {
      const value = (lead[fieldKey] || '').trim();
      if (label === 'Not set') return !value;
      return value === label;
    });
    return {
      label,
      count: matched.length,
      names: matched.map((lead) => lead.studentName).filter(Boolean),
    };
  });
}

function mapNatStudentRow(lead) {
  return {
    studentName: lead.studentName || '',
    natChannel: lead.natChannel || '',
    natCampaign: lead.natCampaign || '',
    natLanguage: lead.natLanguage || '',
    natCounsellorBy: lead.natCounsellorBy || '',
    natCbaName: lead.natCbaName || '',
    natBeforeSessionStage: lead.natBeforeSessionStage || '',
    natPresentStage: lead.natPresentStage || '',
  };
}

function buildNatTrackingSummary(leads) {
  const students = leads
    .map(mapNatStudentRow)
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

  return {
    totalConfirmed: leads.length,
    students,
    byChannel: buildNatFieldBreakdown(leads, 'natChannel', NAT_CHANNEL_OPTIONS),
    byCampaign: buildNatFieldBreakdown(leads, 'natCampaign', NAT_CAMPAIGN_OPTIONS),
    byLanguage: buildNatFieldBreakdown(leads, 'natLanguage', NAT_LANGUAGE_OPTIONS),
    byCounsellorBy: buildNatFieldBreakdown(leads, 'natCounsellorBy', NAT_COUNSELLOR_BY_OPTIONS),
    byCbaName: buildNatFieldBreakdown(leads, 'natCbaName', NAT_CBA_NAME_OPTIONS),
    byBeforeSessionStage: buildNatFieldBreakdown(
      leads,
      'natBeforeSessionStage',
      NAT_SESSION_STAGE_OPTIONS
    ),
    byPresentStage: buildNatFieldBreakdown(leads, 'natPresentStage', NAT_SESSION_STAGE_OPTIONS),
  };
}

function counselorNatLeadMatch(counselorId, counselorName) {
  const name = typeof counselorName === 'string' ? counselorName.trim() : '';
  const clauses = [{ oneOnOneCounselorId: counselorId }];
  if (name) {
    clauses.push({ natCounsellorName: name });
  }
  return {
    bookingConfirmed: true,
    $or: clauses,
  };
}

exports.getCounselorStats = async (req, res) => {
  try {
    const counselorId = req.oneOnOneCounselor._id;
    const counselorName = req.oneOnOneCounselor.name || '';
    const natLeadMatch = counselorNatLeadMatch(counselorId, counselorName);
    const [slotCount, activeSlots, bookingCount, attended, leads] = await Promise.all([
      GuidanceSlot.countDocuments({ oneOnOneCounselorId: counselorId }),
      GuidanceSlot.countDocuments({ oneOnOneCounselorId: counselorId, isActive: true }),
      OneOnOneCounselingLead.countDocuments({
        oneOnOneCounselorId: counselorId,
        bookingConfirmed: true,
      }),
      OneOnOneCounselingLead.countDocuments({
        oneOnOneCounselorId: counselorId,
        bookingStatus: 'Attended',
      }),
      OneOnOneCounselingLead.find(natLeadMatch)
        .select(
          'studentName natChannel natCampaign natLanguage natCounsellorBy natCbaName natBeforeSessionStage natPresentStage natCounsellorName'
        )
        .sort({ studentName: 1 })
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        slotCount,
        activeSlots,
        bookingCount,
        attended,
        nat: buildNatTrackingSummary(leads),
      },
    });
  } catch (err) {
    console.error('[getCounselorStats]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
