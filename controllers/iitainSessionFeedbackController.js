const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const IitainSessionFeedbackSubmission = require('../models/IitainSessionFeedbackSubmission');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');

function isValidUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseYesNo(value) {
  if (value === true || value === 'yes' || value === 'Yes') return true;
  if (value === false || value === 'no' || value === 'No') return false;
  return null;
}

function toAdminRow(doc) {
  return {
    id: doc._id,
    counselorName: doc.counselorName,
    studentName: doc.studentName,
    registeredForNat: doc.registeredForNat,
    sessionSummary: doc.sessionSummary,
    sessionRecordingLink: doc.sessionRecordingLink || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function buildDateRange(from, to) {
  const range = {};
  const parse = (str) => {
    if (!str || typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str.trim())) return null;
    const d = new Date(`${str.trim()}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const start = parse(from);
  if (start) {
    start.setUTCHours(0, 0, 0, 0);
    range.$gte = start;
  }
  const end = parse(to);
  if (end) {
    end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return Object.keys(range).length ? range : null;
}

function buildAdminSearchQuery(q) {
  if (!q) return null;
  const term = String(q).trim();
  if (!term) return null;
  return {
    $or: [
      { counselorName: { $regex: term, $options: 'i' } },
      { studentName: { $regex: term, $options: 'i' } },
      { sessionSummary: { $regex: term, $options: 'i' } },
    ],
  };
}

/**
 * GET /api/iitain-session-feedback/counselors
 * Active one-on-one IIT mentors (same list as admin → One-on-One Counselors).
 */
exports.getIitainSessionFeedbackCounselors = async (req, res) => {
  try {
    const rows = await OneOnOneCounselor.find({
      isActive: true,
      name: { $exists: true, $ne: '' },
    })
      .select('name')
      .sort({ name: 1 })
      .lean();

    const data = rows
      .map((row) => (typeof row.name === 'string' ? row.name.trim() : ''))
      .filter((name) => name.length >= 2);

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[getIitainSessionFeedbackCounselors]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/iitain-session-feedback
 */
exports.submitIitainSessionFeedback = async (req, res) => {
  try {
    const b = req.body || {};
    const counselorName = b.counselorName != null ? String(b.counselorName).trim() : '';
    const studentName = b.studentName != null ? String(b.studentName).trim() : '';
    const registeredForNat = parseYesNo(b.registeredForNat);
    const sessionSummary = b.sessionSummary != null ? String(b.sessionSummary).trim() : '';
    const sessionRecordingLink =
      b.sessionRecordingLink != null ? String(b.sessionRecordingLink).trim().slice(0, 2000) : '';

    if (counselorName.length < 2 || counselorName.length > 100) {
      return res.status(400).json({ success: false, message: 'Select a valid counselor.' });
    }
    if (studentName.length < 2 || studentName.length > 100) {
      return res.status(400).json({ success: false, message: 'Student name must be 2–100 characters.' });
    }
    if (registeredForNat === null) {
      return res.status(400).json({ success: false, message: 'Select whether the student registered for NAT.' });
    }
    if (sessionSummary.length < 5) {
      return res.status(400).json({ success: false, message: 'Describe what happened in the session (at least 5 characters).' });
    }
    if (!sessionRecordingLink) {
      return res.status(400).json({ success: false, message: 'Session recording link is required.' });
    }
    if (!isValidUrl(sessionRecordingLink)) {
      return res.status(400).json({ success: false, message: 'Enter a valid session recording link (http or https).' });
    }

    const doc = await IitainSessionFeedbackSubmission.create({
      counselorName,
      studentName,
      registeredForNat,
      sessionSummary,
      sessionRecordingLink,
    });

    return res.status(201).json({
      success: true,
      message: 'Submitted successfully',
      data: toAdminRow(doc),
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitIitainSessionFeedback]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/**
 * GET /api/admin/iitain-session-feedback
 */
exports.getIitainSessionFeedbackSubmissions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildAdminSearchQuery(req.query.q);

    const match = {};
    if (dateRange) match.createdAt = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);

    if (req.query.counselorName) {
      const counselorName = String(req.query.counselorName).trim();
      if (counselorName) match.counselorName = counselorName;
    }
    if (req.query.registeredForNat === 'yes') match.registeredForNat = true;
    if (req.query.registeredForNat === 'no') match.registeredForNat = false;

    const [docs, total, natYes, natNo] = await Promise.all([
      IitainSessionFeedbackSubmission.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      IitainSessionFeedbackSubmission.countDocuments(match),
      IitainSessionFeedbackSubmission.countDocuments({ ...match, registeredForNat: true }),
      IitainSessionFeedbackSubmission.countDocuments({ ...match, registeredForNat: false }),
    ]);

    return res.status(200).json({
      success: true,
      data: docs.map(toAdminRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stats: {
        total,
        registeredForNatYes: natYes,
        registeredForNatNo: natNo,
      },
    });
  } catch (err) {
    console.error('[getIitainSessionFeedbackSubmissions]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
