const TrainingFeedback = require('../models/TrainingFeedback');
const AssessmentSubmission3 = require('../models/AssessmentSubmission3');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(0, 10);
}

/**
 * POST /api/feedback — submit training feedback (public).
 */
exports.submitTrainingFeedback = async (req, res) => {
  try {
    const b = req.body || {};
    const name = (b.name && String(b.name).trim()) || '';
    const mobileNumber = to10Digits(b.mobileNumber);
    const whatsappNumber = to10Digits(b.whatsappNumber);
    const email = (b.email && String(b.email).trim().toLowerCase()) || '';
    const addressOfCommunication = (b.addressOfCommunication && String(b.addressOfCommunication).trim()) || '';
    const occupation = (b.occupation && String(b.occupation).trim()) || '';
    const dateOfBirth = b.dateOfBirth;
    const gender = b.gender;
    const educationQualification = (b.educationQualification && String(b.educationQualification).trim()) || '';
    const yearsOfExperience = b.yearsOfExperience;
    const anythingToConvey = (b.anythingToConvey && String(b.anythingToConvey).trim().slice(0, 1000)) || '';

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ success: false, message: 'Name must be 2–100 characters.' });
    }
    if (mobileNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits.' });
    }
    if (whatsappNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'WhatsApp number must be 10 digits.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' });
    }
    if (addressOfCommunication.length < 10 || addressOfCommunication.length > 500) {
      return res.status(400).json({ success: false, message: 'Address must be 10–500 characters.' });
    }
    if (!occupation || occupation.length > 200) {
      return res.status(400).json({ success: false, message: 'Occupation is required.' });
    }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    if (!dob || Number.isNaN(dob.getTime())) {
      return res.status(400).json({ success: false, message: 'Valid date of birth is required.' });
    }
    const now = new Date();
    if (dob > now) {
      return res.status(400).json({ success: false, message: 'Date of birth must be in the past.' });
    }
    const ageYears = (now - dob) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18 || ageYears > 80) {
      return res.status(400).json({ success: false, message: 'Age must be between 18 and 80.' });
    }
    if (gender !== 'Male' && gender !== 'Female') {
      return res.status(400).json({ success: false, message: 'Gender must be Male or Female.' });
    }
    if (!educationQualification || educationQualification.length > 200) {
      return res.status(400).json({ success: false, message: 'Education qualification is required.' });
    }
    const yoe = Number(yearsOfExperience);
    if (Number.isNaN(yoe) || yoe < 0 || yoe > 50 || yoe !== Math.floor(yoe)) {
      return res.status(400).json({ success: false, message: 'Years of experience must be 0–50.' });
    }

    // Only allow submission if user completed training (phone in AssessmentSubmission3)
    const inAssessment3 = await AssessmentSubmission3.findOne({ phone: mobileNumber }).lean();
    if (!inAssessment3) {
      return res.status(403).json({
        success: false,
        code: 'NOT_COMPLETED_TRAINING',
        message: 'You have not yet completed the assessments. Please complete the training first.'
      });
    }

    // Prevent duplicate activation feedback
    const existingFeedback = await TrainingFeedback.findOne({
      $or: [{ mobileNumber }, { whatsappNumber }]
    }).lean();
    if (existingFeedback) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'You have already completed the feedback.'
      });
    }

    const doc = {
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
    if (anythingToConvey) doc.anythingToConvey = anythingToConvey;

    const record = await TrainingFeedback.create(doc);

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
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitTrainingFeedback]', err.name, err.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
      ...(process.env.EXPOSE_API_ERROR === 'true' && { detail: err.message })
    });
  }
};

// ----- Admin: get training feedback list -----

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
      TrainingFeedback.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      TrainingFeedback.countDocuments(match),
      TrainingFeedback.aggregate([{ $match: match }, { $group: { _id: '$gender', count: { $sum: 1 } } }])
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
      pagination: { page, limit, total, totalPages },
      stats
    });
  } catch (err) {
    console.error('[getTrainingFeedback]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
