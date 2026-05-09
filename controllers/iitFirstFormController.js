const IitFirstFormSubmission = require('../models/IitFirstFormSubmission');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const otpRepository = require('../utils/otpRepository');

function normalizeMobile(value) {
  return otpRepository.normalize(value || '');
}

exports.submitIitFirstForm = async (req, res) => {
  try {
    const { name, mobileNumber, interestedInAiLearning } = req.body || {};
    const rawName = typeof name === 'string' ? name.trim() : '';
    const mobile = normalizeMobile(mobileNumber || '');
    const interestRaw = typeof interestedInAiLearning === 'string' ? interestedInAiLearning : '';
    const interest = interestRaw.trim();

    if (!rawName || rawName.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required (at least 2 characters)' });
    }
    if (rawName.length > 100) {
      return res.status(400).json({ success: false, message: 'Name must be at most 100 characters' });
    }
    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }
    if (!interest) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your answer (at least one character)',
      });
    }
    if (interest.length > 2000) {
      return res.status(400).json({ success: false, message: 'Response must be at most 2000 characters' });
    }

    const record = await IitFirstFormSubmission.create({
      name: rawName,
      mobileNumber: mobile,
      interestedInAiLearning: interest,
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you. Your response has been saved.',
      data: {
        id: record._id,
        name: record.name,
        mobileNumber: record.mobileNumber,
        interestedInAiLearning: record.interestedInAiLearning,
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
    console.error('[submitIitFirstForm] Error:', error);
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

function mapFirstFormRow(r) {
  return {
    id: r._id,
    name: r.name,
    mobileNumber: r.mobileNumber,
    timestamp: r.submittedAt,
    interestedInAiLearning: r.interestedInAiLearning,
  };
}

/** Admin list: same pagination / dedupe behaviour as IIT meet attendance (`submittedAt` vs `timestamp`). */
exports.getIitFirstFormSubmissions = async (req, res) => {
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
    if (dateRange) match.submittedAt = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);

    const statsPipeline = [{ $match: match }, { $group: { _id: '$mobileNumber' } }, { $count: 'uniqueAttendees' }];

    if (uniqueByMobile) {
      const pipeline = [
        { $match: match },
        { $sort: { submittedAt: sortDirection } },
        {
          $group: {
            _id: '$mobileNumber',
            record: { $first: '$$ROOT' },
          },
        },
        { $replaceRoot: { newRoot: '$record' } },
        { $sort: { submittedAt: sortDirection } },
        { $skip: skip },
        { $limit: limit },
      ];

      const [records, totalRecords, uniqueAgg] = await Promise.all([
        IitFirstFormSubmission.aggregate(pipeline),
        IitFirstFormSubmission.countDocuments(match),
        IitFirstFormSubmission.aggregate(statsPipeline),
      ]);

      const uniqueAttendees = uniqueAgg[0]?.uniqueAttendees || 0;
      const duplicateCount = Math.max(0, totalRecords - uniqueAttendees);
      const totalPages = Math.ceil(uniqueAttendees / limit) || 1;

      const data = records.map(mapFirstFormRow);

      return res.status(200).json({
        success: true,
        data,
        pagination: { page, limit, total: uniqueAttendees, totalPages },
        stats: { totalRecords, uniqueAttendees, duplicateCount },
      });
    }

    const [records, totalRecords, uniqueAgg] = await Promise.all([
      IitFirstFormSubmission.find(match).sort({ submittedAt: -1 }).skip(skip).limit(limit).lean(),
      IitFirstFormSubmission.countDocuments(match),
      IitFirstFormSubmission.aggregate(statsPipeline),
    ]);

    const uniqueAttendees = uniqueAgg[0]?.uniqueAttendees || 0;
    const duplicateCount = Math.max(0, totalRecords - uniqueAttendees);
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    const data = records.map(mapFirstFormRow);

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total: totalRecords, totalPages },
      stats: { totalRecords, uniqueAttendees, duplicateCount },
    });
  } catch (error) {
    console.error('[getIitFirstFormSubmissions] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
