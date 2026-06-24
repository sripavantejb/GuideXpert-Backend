const CollegeDostMeetAttendance = require('../models/CollegeDostMeetAttendance');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const otpRepository = require('../utils/otpRepository');
const otpStore = require('../utils/otpStore');
const VerifiedPhoneSession = require('../models/VerifiedPhoneSession');

const VERIFIED_TTL_MS = 15 * 60 * 1000;

function normalizeMobile(value) {
  return otpRepository.normalize(value || '');
}

async function isPhoneVerified(phone) {
  if (otpStore.isVerified(phone)) return true;
  const since = new Date(Date.now() - VERIFIED_TTL_MS);
  const session = await VerifiedPhoneSession.findOne({ phone, verifiedAt: { $gte: since } }).lean();
  return Boolean(session);
}

function buildDateRange(from, to) {
  const range = {};
  if (from) {
    const start = new Date(from);
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      range.$gte = start;
    }
  }
  if (to) {
    const end = new Date(to);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
  }
  return Object.keys(range).length ? range : null;
}

function buildSearchQuery(q) {
  if (!q) return null;
  const term = String(q).trim();
  if (!term) return null;
  const digits = term.replace(/\D/g, '');
  const clauses = [{ name: { $regex: term, $options: 'i' } }];
  if (digits) clauses.push({ mobileNumber: { $regex: digits, $options: 'i' } });
  else clauses.push({ mobileNumber: { $regex: term, $options: 'i' } });
  return { $or: clauses };
}

exports.checkCollegeDostMeetStatus = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.query.mobileNumber || '');
    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }

    const meetRecord = await CollegeDostMeetAttendance.findOne({ mobileNumber: mobile })
      .sort({ timestamp: -1 })
      .lean();
    if (!meetRecord) {
      return res.status(200).json({ success: true, exists: false });
    }

    return res.status(200).json({
      success: true,
      exists: true,
      data: {
        name: meetRecord.name,
        mobileNumber: meetRecord.mobileNumber,
      },
    });
  } catch (error) {
    console.error('[checkCollegeDostMeetStatus] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/** Register for /cdgxmeet after OTP verification, then client redirects to Google Meet. */
exports.registerForCollegeDostMeet = async (req, res) => {
  try {
    const { name, mobileNumber } = req.body || {};
    const rawName = typeof name === 'string' ? name.trim() : '';
    const mobile = normalizeMobile(mobileNumber || '');

    if (!rawName || rawName.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required (at least 2 characters)' });
    }
    if (rawName.length > 100) {
      return res.status(400).json({ success: false, message: 'Name must be at most 100 characters' });
    }
    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }

    const verified = await isPhoneVerified(mobile);
    if (!verified) {
      return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
    }

    const record = await CollegeDostMeetAttendance.create({
      name: rawName,
      mobileNumber: mobile,
      attendanceStatus: 'joined',
    });

    return res.status(201).json({
      success: true,
      message: 'Registered for CollegeDost meet',
      data: {
        id: record._id,
        name: record.name,
        mobileNumber: record.mobileNumber,
        timestamp: record.timestamp,
        attendanceStatus: record.attendanceStatus,
      },
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed' });
    }
    console.error('[registerForCollegeDostMeet] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.getCollegeDostMeetAttendance = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const uniqueByMobile = String(req.query.uniqueByMobile || '').toLowerCase() === 'true';
    const dedupeMode = String(req.query.dedupeMode || 'latest').toLowerCase();
    const sortDirection = dedupeMode === 'oldest' ? 1 : -1;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildSearchQuery(req.query.q);

    const match = {};
    if (dateRange) match.timestamp = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);

    const statsPipeline = [{ $match: match }, { $group: { _id: '$mobileNumber' } }, { $count: 'uniqueAttendees' }];

    if (uniqueByMobile) {
      const pipeline = [
        { $match: match },
        { $sort: { timestamp: sortDirection } },
        { $group: { _id: '$mobileNumber', record: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$record' } },
        { $sort: { timestamp: sortDirection } },
        { $skip: skip },
        { $limit: limit },
      ];

      const [records, totalRecords, uniqueAgg] = await Promise.all([
        CollegeDostMeetAttendance.aggregate(pipeline),
        CollegeDostMeetAttendance.countDocuments(match),
        CollegeDostMeetAttendance.aggregate(statsPipeline),
      ]);

      const uniqueAttendees = uniqueAgg[0]?.uniqueAttendees || 0;
      const duplicateCount = Math.max(0, totalRecords - uniqueAttendees);
      const totalPages = Math.ceil(uniqueAttendees / limit) || 1;

      const data = records.map((r) => ({
        id: r._id,
        name: r.name,
        mobileNumber: r.mobileNumber,
        timestamp: r.timestamp,
        attendanceStatus: r.attendanceStatus,
        createdAt: r.createdAt,
      }));

      return res.status(200).json({
        success: true,
        data,
        pagination: { page, limit, total: uniqueAttendees, totalPages },
        stats: { totalRecords, uniqueAttendees, duplicateCount },
      });
    }

    const [records, totalRecords, uniqueAgg] = await Promise.all([
      CollegeDostMeetAttendance.find(match).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      CollegeDostMeetAttendance.countDocuments(match),
      CollegeDostMeetAttendance.aggregate(statsPipeline),
    ]);

    const uniqueAttendees = uniqueAgg[0]?.uniqueAttendees || 0;
    const duplicateCount = Math.max(0, totalRecords - uniqueAttendees);
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    const data = records.map((r) => ({
      id: r._id,
      name: r.name,
      mobileNumber: r.mobileNumber,
      timestamp: r.timestamp,
      attendanceStatus: r.attendanceStatus,
      createdAt: r.createdAt,
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total: totalRecords, totalPages },
      stats: { totalRecords, uniqueAttendees, duplicateCount },
    });
  } catch (error) {
    console.error('[getCollegeDostMeetAttendance] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
