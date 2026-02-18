const TrainingFeedback = require('../models/TrainingFeedback');

function normalizeMobile(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\D/g, '').trim();
}

exports.submitTrainingFeedback = async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mobileNumber = normalizeMobile(body.mobileNumber || '');
    const whatsappNumber = normalizeMobile(body.whatsappNumber || '');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const addressOfCommunication = typeof body.addressOfCommunication === 'string' ? body.addressOfCommunication.trim() : '';
    const occupation = typeof body.occupation === 'string' ? body.occupation.trim() : '';
    const dateOfBirth = body.dateOfBirth;
    const gender = body.gender;
    const educationQualification = typeof body.educationQualification === 'string' ? body.educationQualification.trim() : '';
    const yearsOfExperience = body.yearsOfExperience;
    const anythingToConvey = typeof body.anythingToConvey === 'string' ? body.anythingToConvey.trim().slice(0, 1000) : '';

    if (!name || name.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required (at least 2 characters)' });
    }
    if (name.length > 100) {
      return res.status(400).json({ success: false, message: 'Name must be at most 100 characters' });
    }
    if (!mobileNumber || mobileNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }
    if (!whatsappNumber || whatsappNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit WhatsApp number is required' });
    }
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email address is required' });
    }
    if (!addressOfCommunication || addressOfCommunication.length < 10) {
      return res.status(400).json({ success: false, message: 'Address of communication is required (at least 10 characters)' });
    }
    if (addressOfCommunication.length > 500) {
      return res.status(400).json({ success: false, message: 'Address must be at most 500 characters' });
    }
    if (!occupation || occupation.length > 200) {
      return res.status(400).json({ success: false, message: 'Occupation is required' });
    }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    if (!dob || Number.isNaN(dob.getTime())) {
      return res.status(400).json({ success: false, message: 'Valid date of birth is required' });
    }
    const now = new Date();
    if (dob > now) {
      return res.status(400).json({ success: false, message: 'Date of birth must be in the past' });
    }
    const ageYears = (now - dob) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18 || ageYears > 80) {
      return res.status(400).json({ success: false, message: 'Date of birth must indicate age between 18 and 80 years' });
    }
    if (gender !== 'Male' && gender !== 'Female') {
      return res.status(400).json({ success: false, message: 'Gender must be Male or Female' });
    }
    if (!educationQualification || educationQualification.length > 200) {
      return res.status(400).json({ success: false, message: 'Education qualification is required' });
    }
    const yoe = Number(yearsOfExperience);
    if (typeof yoe !== 'number' || Number.isNaN(yoe) || yoe < 0 || yoe > 50) {
      return res.status(400).json({ success: false, message: 'Years of experience must be a number between 0 and 50' });
    }

    const createPayload = {
      name,
      mobileNumber,
      whatsappNumber,
      email,
      addressOfCommunication,
      occupation,
      dateOfBirth: dob,
      gender,
      educationQualification,
      yearsOfExperience: Math.floor(yoe)
    };
    if (anythingToConvey && String(anythingToConvey).trim()) {
      createPayload.anythingToConvey = String(anythingToConvey).trim().slice(0, 1000);
    }

    const record = await TrainingFeedback.create(createPayload);

    return res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        id: record._id,
        name: record.name,
        email: record.email,
        createdAt: record.createdAt
      }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed' });
    }
    if (error.name === 'MongoServerSelectionError' || error.name === 'MongoNetworkError') {
      console.error('[submitTrainingFeedback] MongoDB connection error:', error.message);
      return res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again in a moment.' });
    }
    console.error('[submitTrainingFeedback] Error:', error.name, error.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error(error.stack);
    }
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
  const clauses = [
    { name: { $regex: term, $options: 'i' } },
    { email: { $regex: term, $options: 'i' } }
  ];
  if (digits) {
    clauses.push({ mobileNumber: { $regex: digits, $options: 'i' } });
    clauses.push({ whatsappNumber: { $regex: digits, $options: 'i' } });
  } else {
    clauses.push({ mobileNumber: { $regex: term, $options: 'i' } });
    clauses.push({ whatsappNumber: { $regex: term, $options: 'i' } });
  }
  return { $or: clauses };
}

exports.getTrainingFeedback = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildSearchQuery(req.query.q);
    const gender = req.query.gender;
    const occupation = req.query.occupation;

    const match = {};
    if (dateRange) match.createdAt = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);
    if (gender === 'Male' || gender === 'Female') match.gender = gender;
    if (occupation && String(occupation).trim()) {
      match.occupation = { $regex: String(occupation).trim(), $options: 'i' };
    }

    const [records, total, genderStats] = await Promise.all([
      TrainingFeedback.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      TrainingFeedback.countDocuments(match),
      TrainingFeedback.aggregate([
        { $match: match },
        { $group: { _id: '$gender', count: { $sum: 1 } } }
      ])
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const stats = {
      total,
      byGender: (genderStats || []).reduce((acc, g) => {
        acc[g._id] = g.count;
        return acc;
      }, {})
    };

    const data = records.map((r) => ({
      id: r._id,
      name: r.name,
      mobileNumber: r.mobileNumber,
      whatsappNumber: r.whatsappNumber,
      email: r.email,
      addressOfCommunication: r.addressOfCommunication,
      occupation: r.occupation,
      dateOfBirth: r.dateOfBirth,
      gender: r.gender,
      educationQualification: r.educationQualification,
      yearsOfExperience: r.yearsOfExperience,
      anythingToConvey: r.anythingToConvey,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages
      },
      stats
    });
  } catch (error) {
    console.error('[getTrainingFeedback] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
