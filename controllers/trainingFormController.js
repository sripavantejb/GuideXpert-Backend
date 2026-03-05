const TrainingFormResponse = require('../models/TrainingFormResponse');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(0, 10);
}

/**
 * POST /api/training-form — submit training form (public).
 */
exports.submitTrainingFormResponse = async (req, res) => {
  try {
    const b = req.body || {};
    const fullName = (b.fullName && String(b.fullName).trim()) || '';
    const mobileNumber = to10Digits(b.mobileNumber);
    const email = (b.email && String(b.email).trim().toLowerCase()) || '';
    const occupation = (b.occupation && String(b.occupation).trim()) || '';
    const sessionRating = b.sessionRating != null ? Number(b.sessionRating) : NaN;
    const suggestions = (b.suggestions && String(b.suggestions).trim().slice(0, 2000)) || '';

    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({ success: false, message: 'Name must be 2–100 characters.' });
    }
    if (mobileNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' });
    }
    if (!occupation || occupation.length > 200) {
      return res.status(400).json({ success: false, message: 'Occupation is required.' });
    }
    if (!Number.isInteger(sessionRating) || sessionRating < 1 || sessionRating > 5) {
      return res.status(400).json({ success: false, message: 'Session rating must be 1–5.' });
    }

    const doc = {
      fullName,
      mobileNumber,
      email,
      occupation,
      sessionRating,
      suggestions
    };

    const record = await TrainingFormResponse.create(doc);

    return res.status(201).json({
      success: true,
      message: 'Form submitted successfully',
      data: {
        id: record._id,
        fullName: record.fullName,
        email: record.email,
        createdAt: record.createdAt
      }
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitTrainingFormResponse]', err);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message
    });
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
  const clauses = [
    { fullName: { $regex: term, $options: 'i' } },
    { email: { $regex: term, $options: 'i' } },
    { occupation: { $regex: term, $options: 'i' } }
  ];
  if (digits) {
    clauses.push({ mobileNumber: { $regex: digits, $options: 'i' } });
  } else {
    clauses.push({ mobileNumber: { $regex: term, $options: 'i' } });
  }
  return { $or: clauses };
}

/**
 * GET /api/admin/training-form-responses — list responses (admin).
 */
exports.getTrainingFormResponses = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildSearchQuery(req.query.q);
    const sessionRating = req.query.sessionRating != null ? parseInt(req.query.sessionRating, 10) : null;

    const match = {};
    if (dateRange) match.createdAt = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);
    if (Number.isInteger(sessionRating) && sessionRating >= 1 && sessionRating <= 5) {
      match.sessionRating = sessionRating;
    }

    const [records, total, ratingStats] = await Promise.all([
      TrainingFormResponse.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      TrainingFormResponse.countDocuments(match),
      TrainingFormResponse.aggregate([{ $match: match }, { $group: { _id: '$sessionRating', count: { $sum: 1 } } }])
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const stats = {
      total,
      bySessionRating: (ratingStats || []).reduce((acc, r) => {
        acc[r._id] = r.count;
        return acc;
      }, {})
    };

    const data = records.map((r) => ({
      id: r._id,
      fullName: r.fullName,
      mobileNumber: r.mobileNumber,
      email: r.email,
      occupation: r.occupation,
      sessionRating: r.sessionRating,
      suggestions: r.suggestions,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages },
      stats
    });
  } catch (err) {
    console.error('[getTrainingFormResponses]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
