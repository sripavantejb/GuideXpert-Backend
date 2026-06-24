const CollegeDostFormSubmission = require('../models/CollegeDostFormSubmission');
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

function mapCollegeDostRow(r) {
  return {
    id: r._id,
    name: r.name,
    mobileNumber: r.mobileNumber,
    interestedInNewColleges: r.interestedInNewColleges,
    timestamp: r.submittedAt,
  };
}

exports.submitCollegeDostForm = async (req, res) => {
  try {
    const { name, mobileNumber, interestedInNewColleges } = req.body || {};
    const rawName = typeof name === 'string' ? name.trim() : '';
    const mobile = normalizeMobile(mobileNumber || '');
    const interest = typeof interestedInNewColleges === 'string' ? interestedInNewColleges.trim().toLowerCase() : '';

    if (!rawName || rawName.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required (at least 2 characters)' });
    }
    if (rawName.length > 100) {
      return res.status(400).json({ success: false, message: 'Name must be at most 100 characters' });
    }
    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }
    if (!['yes', 'no'].includes(interest)) {
      return res.status(400).json({ success: false, message: 'Please select Yes or No' });
    }

    const verified = await isPhoneVerified(mobile);
    if (!verified) {
      return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
    }

    const record = await CollegeDostFormSubmission.findOneAndUpdate(
      { mobileNumber: mobile },
      {
        $set: {
          name: rawName,
          mobileNumber: mobile,
          interestedInNewColleges: interest,
          otpVerified: true,
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Submitted successfully',
      data: {
        id: record._id,
        name: record.name,
        mobileNumber: record.mobileNumber,
        interestedInNewColleges: record.interestedInNewColleges,
        submittedAt: record.submittedAt,
      },
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed' });
    }
    console.error('[submitCollegeDostForm] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

exports.getCollegeDostFormSubmissions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildSearchQuery(req.query.q);

    const match = {};
    if (dateRange) match.submittedAt = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);

    const [records, total] = await Promise.all([
      CollegeDostFormSubmission.find(match).sort({ submittedAt: -1 }).skip(skip).limit(limit).lean(),
      CollegeDostFormSubmission.countDocuments(match),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const data = records.map(mapCollegeDostRow);

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    console.error('[getCollegeDostFormSubmissions] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
