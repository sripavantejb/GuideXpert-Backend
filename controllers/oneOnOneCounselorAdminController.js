const mongoose = require('mongoose');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const NatCampaignSubmission = require('../models/NatCampaignSubmission');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const { mapLeadBookingDTO, cancelGuidanceBookingForLead } = require('../services/guidanceBookingService');
const { getGuidanceReminderStatusBySlotDate, SUPPORTED_STATUS_MESSAGE_KINDS } = require('../services/guidanceReminderStatusService');

function mapCounselorRow(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    mobile: doc.mobile || '',
    profileImage: doc.profileImage || '',
    collegeName: doc.collegeName || '',
    designation: doc.designation || '',
    bio: doc.bio || '',
    isActive: doc.isActive !== false,
    role: doc.role || 'oneOnOneCounselor',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NAT_INTERESTED_OPTIONS = ['', 'yes', 'no', 'undecided'];

const COLLEGE_PREF_LABELS = {
  'zenith-school-of-ai': 'Zenith School of AI',
  niat: 'NIAT',
  scaler: 'Scaler',
  newton: 'Newton',
  others: 'Others',
};

function formatNatCollegePreferences(submission) {
  if (!submission) return '';
  const preferences = Array.isArray(submission.collegePreferences) ? submission.collegePreferences : [];
  if (!preferences.length) return '';
  return preferences
    .map((value) => {
      if (value === 'others') {
        return submission.collegePreferenceOther
          ? `Others: ${submission.collegePreferenceOther}`
          : 'Others';
      }
      return COLLEGE_PREF_LABELS[value] || value;
    })
    .join(', ');
}

async function buildGuidanceBookingsMatch(query) {
  const match = {};
  const bookingFilter = typeof query.bookingFilter === 'string' ? query.bookingFilter.trim() : '';
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

  if (query.parentAttendanceConfirmed === 'true') {
    match.parentAttendanceConfirmed = true;
  }
  if (query.whatsappConsent === 'true') {
    match.whatsappConsent = true;
  }
  if (mongoose.Types.ObjectId.isValid(query.selectedSlotId)) {
    match.selectedSlotId = query.selectedSlotId;
  }
  if (mongoose.Types.ObjectId.isValid(query.oneOnOneCounselorId)) {
    match.oneOnOneCounselorId = query.oneOnOneCounselorId;
  }
  const slotDate = typeof query.slotDate === 'string' ? query.slotDate.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) {
    const slotIds = await GuidanceSlot.find({ slotDate }).distinct('_id');
    match.selectedSlotId = { $in: slotIds };
  }

  const studentName = typeof query.studentName === 'string' ? query.studentName.trim() : '';
  if (studentName) {
    match.studentName = { $regex: escapeRegex(studentName), $options: 'i' };
  }

  const mobileRaw = typeof query.mobile === 'string' ? query.mobile.trim() : '';
  const mobileDigits = mobileRaw.replace(/\D/g, '');
  if (mobileDigits) {
    match.mobileNumber = { $regex: escapeRegex(mobileDigits) };
  }

  const natFilter = typeof query.natFilter === 'string' ? query.natFilter.trim() : '';
  if (natFilter === 'initiated') {
    match.natInitiated = true;
  } else if (natFilter === 'notInitiated') {
    match.natInitiated = { $ne: true };
  } else if (natFilter === 'contactLater') {
    match.natContactLater = true;
  } else if (natFilter === 'interestedYes') {
    match.natInterested = 'yes';
  } else if (natFilter === 'interestedNo') {
    match.natInterested = 'no';
  }

  return match;
}

function mapSlotRow(doc, counselor) {
  return {
    id: String(doc._id),
    sessionTitle: doc.sessionTitle,
    slotDate: doc.slotDate,
    slotTime: doc.slotTime,
    maxBookings: doc.maxBookings,
    currentBookings: doc.currentBookings,
    isActive: doc.isActive !== false,
    isFull: doc.currentBookings >= doc.maxBookings,
    oneOnOneCounselorId: String(doc.oneOnOneCounselorId),
    counselorName: counselor?.name || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

exports.createCounselor = async (req, res) => {
  try {
    const { name, email, mobile, password, profileImage, collegeName, designation, bio, isActive } =
      req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const emailVal = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const mobileRaw = typeof mobile === 'string' ? mobile.replace(/\D/g, '').slice(-10) : '';

    if (trimmedName.length < 2) {
      return res.status(400).json({ success: false, message: 'Counselor name is required.' });
    }
    if (!emailVal || !emailVal.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' });
    }
    if (mobileRaw && !/^\d{10}$/.test(mobileRaw)) {
      return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const doc = await OneOnOneCounselor.create({
      name: trimmedName,
      email: emailVal,
      mobile: mobileRaw || undefined,
      password,
      profileImage: typeof profileImage === 'string' ? profileImage.trim().slice(0, 500) : '',
      collegeName: typeof collegeName === 'string' ? collegeName.trim().slice(0, 120) : '',
      designation: typeof designation === 'string' ? designation.trim().slice(0, 120) : '',
      bio: typeof bio === 'string' ? bio.trim().slice(0, 2000) : '',
      isActive: isActive !== false,
      createdBy: req.admin?._id || null,
    });

    return res.status(201).json({ success: true, data: mapCounselorRow(doc.toObject()) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email or mobile already exists.' });
    }
    console.error('[createCounselor]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.listCounselors = async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const match = activeOnly ? { isActive: true } : {};
    const rows = await OneOnOneCounselor.find(match).sort({ name: 1 }).lean();
    return res.status(200).json({ success: true, data: rows.map(mapCounselorRow) });
  } catch (err) {
    console.error('[listCounselors]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateCounselor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Counselor not found.' });
    }

    const allowed = [
      'name',
      'email',
      'mobile',
      'profileImage',
      'collegeName',
      'designation',
      'bio',
      'isActive',
    ];
    const updates = {};
    const body = req.body || {};

    if (typeof body.name === 'string' && body.name.trim().length >= 2) updates.name = body.name.trim();
    if (typeof body.email === 'string' && body.email.includes('@')) {
      updates.email = body.email.trim().toLowerCase();
    }
    if (body.mobile !== undefined) {
      const mobileRaw = typeof body.mobile === 'string' ? body.mobile.replace(/\D/g, '').slice(-10) : '';
      if (mobileRaw && !/^\d{10}$/.test(mobileRaw)) {
        return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
      }
      updates.mobile = mobileRaw || undefined;
    }
    if (typeof body.profileImage === 'string') updates.profileImage = body.profileImage.trim().slice(0, 500);
    if (typeof body.collegeName === 'string') updates.collegeName = body.collegeName.trim().slice(0, 120);
    if (typeof body.designation === 'string') updates.designation = body.designation.trim().slice(0, 120);
    if (typeof body.bio === 'string') updates.bio = body.bio.trim().slice(0, 2000);
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

    if (body.password && typeof body.password === 'string' && body.password.length >= 6) {
      const doc = await OneOnOneCounselor.findById(id).select('+password');
      if (!doc) return res.status(404).json({ success: false, message: 'Counselor not found.' });
      doc.password = body.password;
      await doc.save();
    }

    const updated = await OneOnOneCounselor.findByIdAndUpdate(
      id,
      Object.keys(updates).length ? { $set: updates } : {},
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Counselor not found.' });
    }

    return res.status(200).json({ success: true, data: mapCounselorRow(updated) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email or mobile already exists.' });
    }
    console.error('[updateCounselor]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.patchCounselorStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Counselor not found.' });
    }
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be a boolean.' });
    }
    const updated = await OneOnOneCounselor.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Counselor not found.' });
    }
    return res.status(200).json({ success: true, data: mapCounselorRow(updated) });
  } catch (err) {
    console.error('[patchCounselorStatus]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.deleteCounselor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Counselor not found.' });
    }
    const slotCount = await GuidanceSlot.countDocuments({ oneOnOneCounselorId: id });
    if (slotCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete counselor with assigned slots. Deactivate instead.',
      });
    }
    const deleted = await OneOnOneCounselor.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Counselor not found.' });
    }
    return res.status(200).json({ success: true, message: 'Counselor deleted.' });
  } catch (err) {
    console.error('[deleteCounselor]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.createSlot = async (req, res) => {
  try {
    const { sessionTitle, slotDate, slotTime, maxBookings, oneOnOneCounselorId, isActive } =
      req.body || {};
    const title = typeof sessionTitle === 'string' ? sessionTitle.trim() : '';
    const date = typeof slotDate === 'string' ? slotDate.trim() : '';
    const time = typeof slotTime === 'string' ? slotTime.trim() : '';
    const max = parseInt(maxBookings, 10);

    if (title.length < 2) {
      return res.status(400).json({ success: false, message: 'Session title is required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Valid slot date (YYYY-MM-DD) is required.' });
    }
    if (!time) {
      return res.status(400).json({ success: false, message: 'Slot time is required.' });
    }
    if (!Number.isFinite(max) || max < 1) {
      return res.status(400).json({ success: false, message: 'Maximum booking limit must be at least 1.' });
    }
    if (!mongoose.Types.ObjectId.isValid(oneOnOneCounselorId)) {
      return res.status(400).json({ success: false, message: 'Assign a valid one-on-one counselor.' });
    }

    const counselor = await OneOnOneCounselor.findById(oneOnOneCounselorId).lean();
    if (!counselor) {
      return res.status(400).json({ success: false, message: 'Counselor not found.' });
    }

    const doc = await GuidanceSlot.create({
      sessionTitle: title,
      slotDate: date,
      slotTime: time,
      maxBookings: max,
      currentBookings: 0,
      isActive: isActive !== false,
      oneOnOneCounselorId,
      createdBy: req.admin?._id || null,
    });

    return res.status(201).json({
      success: true,
      data: mapSlotRow(doc.toObject(), counselor),
    });
  } catch (err) {
    console.error('[createSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.listSlots = async (req, res) => {
  try {
    const counselorId = typeof req.query.counselorId === 'string' ? req.query.counselorId.trim() : '';
    const slotDate = typeof req.query.slotDate === 'string' ? req.query.slotDate.trim() : '';
    const isActiveRaw = typeof req.query.isActive === 'string' ? req.query.isActive.trim() : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const availability =
      typeof req.query.availability === 'string' ? req.query.availability.trim() : '';

    const match = {};
    if (mongoose.Types.ObjectId.isValid(counselorId)) {
      match.oneOnOneCounselorId = counselorId;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) {
      match.slotDate = slotDate;
    }
    if (isActiveRaw === 'true') {
      match.isActive = true;
    } else if (isActiveRaw === 'false') {
      match.isActive = false;
    }
    if (search.length >= 2) {
      match.sessionTitle = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    let slots = await GuidanceSlot.find(match).sort({ slotDate: -1, slotTime: 1 }).lean();

    if (availability === 'open') {
      slots = slots.filter((s) => (s.currentBookings || 0) < (s.maxBookings || 0));
    } else if (availability === 'full') {
      slots = slots.filter((s) => (s.currentBookings || 0) >= (s.maxBookings || 0));
    }

    const counselorIds = [...new Set(slots.map((s) => String(s.oneOnOneCounselorId)))];
    const counselors = await OneOnOneCounselor.find({ _id: { $in: counselorIds } })
      .select('name')
      .lean();
    const byId = Object.fromEntries(counselors.map((c) => [String(c._id), c]));

    return res.status(200).json({
      success: true,
      data: slots.map((s) => mapSlotRow(s, byId[String(s.oneOnOneCounselorId)])),
    });
  } catch (err) {
    console.error('[listSlots]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateSlot = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }

    const body = req.body || {};
    const updates = {};
    if (typeof body.sessionTitle === 'string' && body.sessionTitle.trim().length >= 2) {
      updates.sessionTitle = body.sessionTitle.trim();
    }
    if (typeof body.slotDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.slotDate.trim())) {
      updates.slotDate = body.slotDate.trim();
    }
    if (typeof body.slotTime === 'string' && body.slotTime.trim()) {
      updates.slotTime = body.slotTime.trim();
    }
    const max = parseInt(body.maxBookings, 10);
    if (Number.isFinite(max) && max >= 1) {
      const existing = await GuidanceSlot.findById(id).lean();
      if (!existing) return res.status(404).json({ success: false, message: 'Slot not found.' });
      if (max < existing.currentBookings) {
        return res.status(400).json({
          success: false,
          message: `Max bookings cannot be less than current bookings (${existing.currentBookings}).`,
        });
      }
      updates.maxBookings = max;
    }
    if (mongoose.Types.ObjectId.isValid(body.oneOnOneCounselorId)) {
      const counselor = await OneOnOneCounselor.findById(body.oneOnOneCounselorId).lean();
      if (!counselor) {
        return res.status(400).json({ success: false, message: 'Counselor not found.' });
      }
      updates.oneOnOneCounselorId = body.oneOnOneCounselorId;
    }
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

    const updated = await GuidanceSlot.findByIdAndUpdate(
      id,
      Object.keys(updates).length ? { $set: updates } : {},
      { new: true, runValidators: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }
    const counselor = await OneOnOneCounselor.findById(updated.oneOnOneCounselorId).select('name').lean();
    return res.status(200).json({ success: true, data: mapSlotRow(updated, counselor) });
  } catch (err) {
    console.error('[updateSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.toggleSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const slot = await GuidanceSlot.findById(id);
    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }
    slot.isActive = !slot.isActive;
    await slot.save();
    const counselor = await OneOnOneCounselor.findById(slot.oneOnOneCounselorId).select('name').lean();
    return res.status(200).json({ success: true, data: mapSlotRow(slot.toObject(), counselor) });
  } catch (err) {
    console.error('[toggleSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.deleteSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const booked = await OneOnOneCounselingLead.countDocuments({
      selectedSlotId: id,
      bookingConfirmed: true,
    });
    if (booked > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete slot with confirmed bookings. Turn off instead.',
      });
    }
    const deleted = await GuidanceSlot.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }
    return res.status(200).json({ success: true, message: 'Slot deleted.' });
  } catch (err) {
    console.error('[deleteSlot]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getGuidanceReminderStatus = async (req, res) => {
  try {
    const slotDate = typeof req.query.slotDate === 'string' ? req.query.slotDate.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) {
      return res.status(400).json({
        success: false,
        message: 'Valid slotDate query (YYYY-MM-DD) is required.',
      });
    }

    const messageKind =
      typeof req.query.messageKind === 'string' ? req.query.messageKind.trim() : '';
    if (messageKind && !SUPPORTED_STATUS_MESSAGE_KINDS.has(messageKind)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported messageKind for guidance slot status.',
      });
    }

    const data = await getGuidanceReminderStatusBySlotDate(slotDate, {
      messageKind: messageKind || undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[getGuidanceReminderStatus]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.cancelGuidanceBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await cancelGuidanceBookingForLead(id);
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.status(200).json({
      success: true,
      message: 'Guidance slot booking cancelled.',
      data: {
        slotId: result.slotId,
        spotsLeft: result.spotsLeft,
        leadDeleted: result.leadDeleted,
      },
    });
  } catch (err) {
    console.error('[cancelGuidanceBooking]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.listGuidanceBookings = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const match = await buildGuidanceBookingsMatch(req.query);

    const [rows, total] = await Promise.all([
      OneOnOneCounselingLead.find(match).sort({ bookingConfirmedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      OneOnOneCounselingLead.countDocuments(match),
    ]);

    const slotIds = rows.filter((r) => r.selectedSlotId).map((r) => r.selectedSlotId);
    const counselorIds = rows.filter((r) => r.oneOnOneCounselorId).map((r) => r.oneOnOneCounselorId);
    const [slots, counselors] = await Promise.all([
      GuidanceSlot.find({ _id: { $in: slotIds } }).lean(),
      OneOnOneCounselor.find({ _id: { $in: counselorIds } }).select('name collegeName').lean(),
    ]);
    const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));
    const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));

    return res.status(200).json({
      success: true,
      data: rows.map((r) =>
        mapLeadBookingDTO(r, slotById[String(r.selectedSlotId)], counselorById[String(r.oneOnOneCounselorId)])
      ),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[listGuidanceBookings]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

function mapNatFollowUpRow(lead, slot, counselor, natSubmission) {
  const base = mapLeadBookingDTO(lead, slot, counselor);
  return {
    ...base,
    natFormSubmitted: Boolean(natSubmission),
    natFormSubmittedAt: natSubmission?.submittedAt || null,
    natCollegePreferences: formatNatCollegePreferences(natSubmission),
    natCollegePreferencesRaw: Array.isArray(natSubmission?.collegePreferences)
      ? natSubmission.collegePreferences
      : [],
    natCollegePreferenceOther: natSubmission?.collegePreferenceOther || '',
  };
}

exports.listGuidanceNatFollowUps = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const match = await buildGuidanceBookingsMatch(req.query);
    if (!req.query.bookingFilter) {
      match.bookingConfirmed = true;
    }

    const natFormFilter = typeof req.query.natFormFilter === 'string' ? req.query.natFormFilter.trim() : '';
    if (natFormFilter === 'submitted' || natFormFilter === 'notSubmitted') {
      const natMobiles = await NatCampaignSubmission.distinct('mobileNumber');
      if (natFormFilter === 'submitted') {
        if (!natMobiles.length) {
          match._id = { $in: [] };
        } else if (match.mobileNumber?.$regex) {
          const regexClause = { mobileNumber: { $regex: match.mobileNumber.$regex, $options: 'i' } };
          delete match.mobileNumber;
          match.$and = [...(match.$and || []), regexClause, { mobileNumber: { $in: natMobiles } }];
        } else {
          match.mobileNumber = { $in: natMobiles };
        }
      } else if (natMobiles.length) {
        const notInClause = { mobileNumber: { $nin: natMobiles } };
        if (match.mobileNumber?.$regex) {
          const regexClause = { mobileNumber: { $regex: match.mobileNumber.$regex, $options: 'i' } };
          delete match.mobileNumber;
          match.$and = [...(match.$and || []), regexClause, notInClause];
        } else {
          match.mobileNumber = { $nin: natMobiles };
        }
      }
    }

    const [rows, total] = await Promise.all([
      OneOnOneCounselingLead.find(match).sort({ bookingConfirmedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      OneOnOneCounselingLead.countDocuments(match),
    ]);

    const slotIds = rows.filter((r) => r.selectedSlotId).map((r) => r.selectedSlotId);
    const counselorIds = rows.filter((r) => r.oneOnOneCounselorId).map((r) => r.oneOnOneCounselorId);
    const mobiles = rows.map((r) => r.mobileNumber).filter(Boolean);
    const [slots, counselors, natSubmissions] = await Promise.all([
      GuidanceSlot.find({ _id: { $in: slotIds } }).lean(),
      OneOnOneCounselor.find({ _id: { $in: counselorIds } }).select('name collegeName').lean(),
      NatCampaignSubmission.find({ mobileNumber: { $in: mobiles } }).lean(),
    ]);
    const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));
    const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));
    const natByMobile = Object.fromEntries(natSubmissions.map((n) => [n.mobileNumber, n]));

    return res.status(200).json({
      success: true,
      data: rows.map((r) =>
        mapNatFollowUpRow(
          r,
          slotById[String(r.selectedSlotId)],
          counselorById[String(r.oneOnOneCounselorId)],
          natByMobile[r.mobileNumber]
        )
      ),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[listGuidanceNatFollowUps]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.patchGuidanceNatFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const update = {};

    if (body.natInitiated !== undefined) {
      update.natInitiated = Boolean(body.natInitiated);
    }
    if (body.natContactLater !== undefined) {
      update.natContactLater = Boolean(body.natContactLater);
    }
    if (body.natInterested !== undefined) {
      const interested = typeof body.natInterested === 'string' ? body.natInterested.trim() : '';
      if (!NAT_INTERESTED_OPTIONS.includes(interested)) {
        return res.status(400).json({ success: false, message: 'Invalid interested value.' });
      }
      update.natInterested = interested;
    }
    if (body.natNotes !== undefined) {
      update.natNotes = typeof body.natNotes === 'string' ? body.natNotes.trim().slice(0, 2000) : '';
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    const lead = await OneOnOneCounselingLead.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean();

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    const [slot, counselor, natSubmission] = await Promise.all([
      lead.selectedSlotId ? GuidanceSlot.findById(lead.selectedSlotId).lean() : null,
      lead.oneOnOneCounselorId
        ? OneOnOneCounselor.findById(lead.oneOnOneCounselorId).select('name collegeName').lean()
        : null,
      NatCampaignSubmission.findOne({ mobileNumber: lead.mobileNumber }).lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: mapNatFollowUpRow(lead, slot, counselor, natSubmission),
    });
  } catch (err) {
    console.error('[patchGuidanceNatFollowUp]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
