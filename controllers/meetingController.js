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
    // Temporarily show actual error for debugging
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Something went wrong. Please try again.',
      errorName: error.name,
      errorCode: error.code
    });
  }
};

exports.getMeetingAttendance = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      MeetingAttendance.find({})
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MeetingAttendance.countDocuments({})
    ]);

    const data = records.map((r) => ({
      id: r._id,
      name: r.name,
      mobileNumber: r.mobileNumber,
      timestamp: r.timestamp,
      attendanceStatus: r.attendanceStatus,
      createdAt: r.createdAt
    }));
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
    console.error('[getMeetingAttendance] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
