const TrainingFormSubmission = require('../models/TrainingFormSubmission');
const TrainingFormResponse = require('../models/TrainingFormResponse');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(-10).slice(0, 10);
}

/** Parse ISO date string (yyyy-mm-dd) only; return null if invalid. */
function parseISODate(str) {
  if (str == null || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(trimmed + 'T00:00:00.000Z');
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

/** True if this mobile already has a training form in live submissions or legacy responses. */
async function hasTrainingFormForMobile(mobile10) {
  if (!mobile10 || mobile10.length !== 10) return false;
  const [sub, resp] = await Promise.all([
    TrainingFormSubmission.findOne({ mobileNumber: mobile10 }).select('_id').lean(),
    TrainingFormResponse.findOne({ mobileNumber: mobile10 }).select('_id').lean(),
  ]);
  return !!(sub || resp);
}

/**
 * GET /api/training-form/check/:phone — public; returns whether this mobile already submitted.
 */
exports.getTrainingFormStatus = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.params.phone);
    if (mobileNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required.' });
    }
    const submitted = await hasTrainingFormForMobile(mobileNumber);
    return res.status(200).json({ success: true, submitted });
  } catch (err) {
    console.error('[getTrainingFormStatus]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

function buildSearchQuery(q) {
  if (!q) return null;
  const term = String(q).trim();
  if (!term) return null;
  const digits = term.replace(/\D/g, '');
  const clauses = [
    { fullName: { $regex: term, $options: 'i' } },
    { email: { $regex: term, $options: 'i' } },
    { occupation: { $regex: term, $options: 'i' } },
  ];
  if (digits.length >= 6) {
    clauses.push({ mobileNumber: { $regex: digits, $options: 'i' } });
  } else {
    clauses.push({ mobileNumber: { $regex: term, $options: 'i' } });
  }
  return { $or: clauses };
}

/**
 * POST /api/training-form — submit training form (public).
 */
exports.submitTrainingForm = async (req, res) => {
  try {
    const b = req.body || {};
    const fullName = (b.fullName && String(b.fullName).trim()) || '';
    const mobileNumber = to10Digits(b.mobileNumber);
    const email = (b.email && String(b.email).trim().toLowerCase()) || '';
    const occupation = (b.occupation && String(b.occupation).trim()) || '';
    const sessionRating = b.sessionRating != null ? Math.min(5, Math.max(1, Math.floor(Number(b.sessionRating)))) : null;
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
    if (sessionRating == null || sessionRating < 1 || sessionRating > 5) {
      return res.status(400).json({ success: false, message: 'Session rating must be 1–5.' });
    }

    if (await hasTrainingFormForMobile(mobileNumber)) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'You have already submitted this form.',
      });
    }

    const doc = await TrainingFormSubmission.create({
      fullName,
      mobileNumber,
      email,
      occupation,
      sessionRating,
      suggestions: suggestions || undefined,
    });

    return res.status(201).json({
      success: true,
      message: 'Submitted successfully',
      data: {
        id: doc._id,
        fullName: doc.fullName,
        mobileNumber: doc.mobileNumber,
        email: doc.email,
        occupation: doc.occupation,
        sessionRating: doc.sessionRating,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitTrainingForm]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

/** Alias for routes that use submitTrainingFormResponse (e.g. trainingFormRoutes). */
exports.submitTrainingFormResponse = exports.submitTrainingForm;

/** Map a raw doc to the API shape (both models share the same schema). */
function toResponseRow(r) {
  return {
    id: r._id,
    fullName: r.fullName,
    mobileNumber: r.mobileNumber,
    email: r.email,
    occupation: r.occupation,
    sessionRating: r.sessionRating,
    suggestions: r.suggestions,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * GET /api/admin/training-form-responses — list with pagination and filters (admin only).
 * Reads from both TrainingFormSubmission (live) and TrainingFormResponse (seeded/imported).
 */
exports.getTrainingFormResponses = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 25));
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

    const [submissionDocs, responseDocs, submissionRatingStats, responseRatingStats] = await Promise.all([
      TrainingFormSubmission.find(match).sort({ createdAt: -1 }).lean(),
      TrainingFormResponse.find(match).sort({ createdAt: -1 }).lean(),
      TrainingFormSubmission.aggregate([{ $match: match }, { $group: { _id: '$sessionRating', count: { $sum: 1 } } }]),
      TrainingFormResponse.aggregate([{ $match: match }, { $group: { _id: '$sessionRating', count: { $sum: 1 } } }]),
    ]);

    const merged = [...submissionDocs, ...responseDocs].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const total = merged.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const pageRecords = merged.slice(skip, skip + limit);

    const bySessionRating = {};
    [...(submissionRatingStats || []), ...(responseRatingStats || [])].forEach((r) => {
      const key = r._id;
      bySessionRating[key] = (bySessionRating[key] || 0) + r.count;
    });

    const data = pageRecords.map(toResponseRow);

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages },
      stats: { total, bySessionRating },
    });
  } catch (err) {
    console.error('[getTrainingFormResponses]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
