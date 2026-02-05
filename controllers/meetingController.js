const MeetingAttendance = require('../models/MeetingAttendance');

exports.meetingHealth = async (req, res) => {
  try {
    await MeetingAttendance.countDocuments();
    return res.status(200).json({ status: 'ok', message: 'Meeting API and DB connected' });
  } catch (error) {
    console.error('[meetingHealth] Error:', error);
    return res
      .status(500)
      .json({ status: 'error', message: process.env.NODE_ENV !== 'production' ? error.message : 'DB or meeting model unavailable' });
  }
};

function normalizeMobile(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\D/g, '').trim();
}

exports.registerForMeeting = async (req, res) => {
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

    const record = await MeetingAttendance.create({
      name: rawName,
      mobileNumber: mobile,
      attendanceStatus: 'joined'
    });

    return res.status(201).json({
      success: true,
      message: 'Registered successfully',
      data: {
        id: record._id,
        name: record.name,
        mobileNumber: record.mobileNumber,
        timestamp: record.timestamp,
        attendanceStatus: record.attendanceStatus
      }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed' });
    }
    console.error('[registerForMeeting] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

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

exports.getMeetingAttendance = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const uniqueByMobile = String(req.query.uniqueByMobile || '').toLowerCase() === 'true';
    const dedupeMode = String(req.query.dedupeMode || 'latest').toLowerCase();
    const sortDirection = dedupeMode === 'oldest' ? 1 : -1;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildSearchQuery(req.query.q);

    const match = {};
    if (dateRange) match.timestamp = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);

    const statsPipeline = [
      { $match: match },
      { $group: { _id: '$mobileNumber' } },
      { $count: 'uniqueAttendees' }
    ];

    if (uniqueByMobile) {
      const pipeline = [
        { $match: match },
        { $sort: { timestamp: sortDirection } },
        {
          $group: {
            _id: '$mobileNumber',
            record: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$record' } },
        { $sort: { timestamp: sortDirection } },
        { $skip: skip },
        { $limit: limit }
      ];

      const [records, totalRecords, uniqueAgg] = await Promise.all([
        MeetingAttendance.aggregate(pipeline),
        MeetingAttendance.countDocuments(match),
        MeetingAttendance.aggregate(statsPipeline)
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
        createdAt: r.createdAt
      }));

      return res.status(200).json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total: uniqueAttendees,
          totalPages
        },
        stats: {
          totalRecords,
          uniqueAttendees,
          duplicateCount
        }
      });
    }

    const [records, totalRecords, uniqueAgg] = await Promise.all([
      MeetingAttendance.find(match)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MeetingAttendance.countDocuments(match),
      MeetingAttendance.aggregate(statsPipeline)
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
      createdAt: r.createdAt
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: totalRecords,
        totalPages
      },
      stats: {
        totalRecords,
        uniqueAttendees,
        duplicateCount
      }
    });
  } catch (error) {
    console.error('[getMeetingAttendance] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
