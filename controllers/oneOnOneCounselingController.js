const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const {
  CURRENT_CLASS_OPTIONS,
  INTERESTED_BRANCH_OPTIONS,
  COLLEGE_BUDGET_OPTIONS,
  BIGGEST_CONCERN_OPTIONS,
  PREFERRED_LANGUAGE_OPTIONS,
  PREFERRED_TIME_SLOT_OPTIONS,
  LEAD_STATUS_OPTIONS,
  INDIAN_MOBILE_REGEX,
} = require('../constants/oneOnOneCounseling');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(-10).slice(0, 10);
}

function parseISODate(str) {
  if (str == null || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
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

function mapLeadToDTO(doc) {
  return {
    id: doc._id,
    studentName: doc.studentName,
    mobileNumber: doc.mobileNumber,
    parentName: doc.parentName,
    parentMobileNumber: doc.parentMobileNumber,
    currentClass: doc.currentClass,
    entranceExamRank: doc.entranceExamRank,
    interestedBranch: doc.interestedBranch,
    collegeBudget: doc.collegeBudget,
    biggestConcern: doc.biggestConcern,
    preferredLanguage: doc.preferredLanguage,
    preferredTimeSlot: doc.preferredTimeSlot,
    additionalQuestions: doc.additionalQuestions || '',
    leadStatus: doc.leadStatus || 'New Lead',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function validateSubmitBody(b) {
  const studentName = (b.studentName && String(b.studentName).trim()) || '';
  const mobileNumber = to10Digits(b.mobileNumber);
  const parentName = (b.parentName && String(b.parentName).trim()) || '';
  const parentMobileNumber = to10Digits(b.parentMobileNumber);
  const currentClass = (b.currentClass && String(b.currentClass).trim()) || '';
  const entranceExamRank = (b.entranceExamRank && String(b.entranceExamRank).trim()) || '';
  const interestedBranch = (b.interestedBranch && String(b.interestedBranch).trim()) || '';
  const collegeBudget = (b.collegeBudget && String(b.collegeBudget).trim()) || '';
  const biggestConcern = (b.biggestConcern && String(b.biggestConcern).trim()) || '';
  const preferredLanguage = (b.preferredLanguage && String(b.preferredLanguage).trim()) || '';
  const preferredTimeSlot = (b.preferredTimeSlot && String(b.preferredTimeSlot).trim()) || '';
  const additionalQuestions =
    (b.additionalQuestions && String(b.additionalQuestions).trim().slice(0, 2000)) || '';

  if (studentName.length < 2 || studentName.length > 100) {
    return { error: 'Student name must be 2–100 characters.' };
  }
  if (!INDIAN_MOBILE_REGEX.test(mobileNumber)) {
    return { error: 'Enter a valid 10-digit Indian mobile number for the student.' };
  }
  if (parentName.length < 2 || parentName.length > 100) {
    return { error: 'Parent name must be 2–100 characters.' };
  }
  if (!INDIAN_MOBILE_REGEX.test(parentMobileNumber)) {
    return { error: 'Enter a valid 10-digit Indian mobile number for the parent.' };
  }
  if (!CURRENT_CLASS_OPTIONS.includes(currentClass)) {
    return { error: 'Please select a valid current class.' };
  }
  if (!entranceExamRank || entranceExamRank.length > 120) {
    return { error: 'Entrance exam rank is required (max 120 characters).' };
  }
  if (!INTERESTED_BRANCH_OPTIONS.includes(interestedBranch)) {
    return { error: 'Please select a valid branch.' };
  }
  if (!COLLEGE_BUDGET_OPTIONS.includes(collegeBudget)) {
    return { error: 'Please select a valid college budget.' };
  }
  if (!BIGGEST_CONCERN_OPTIONS.includes(biggestConcern)) {
    return { error: 'Please select a valid concern.' };
  }
  if (!PREFERRED_LANGUAGE_OPTIONS.includes(preferredLanguage)) {
    return { error: 'Please select a valid language.' };
  }
  if (!PREFERRED_TIME_SLOT_OPTIONS.includes(preferredTimeSlot)) {
    return { error: 'Please select a valid time slot.' };
  }

  return {
    data: {
      studentName,
      mobileNumber,
      parentName,
      parentMobileNumber,
      currentClass,
      entranceExamRank,
      interestedBranch,
      collegeBudget,
      biggestConcern,
      preferredLanguage,
      preferredTimeSlot,
      additionalQuestions,
      utm_source: (b.utm_source && String(b.utm_source).trim().slice(0, 120)) || undefined,
      utm_medium: (b.utm_medium && String(b.utm_medium).trim().slice(0, 120)) || undefined,
      utm_campaign: (b.utm_campaign && String(b.utm_campaign).trim().slice(0, 120)) || undefined,
      utm_content: (b.utm_content && String(b.utm_content).trim().slice(0, 120)) || undefined,
    },
  };
}

/**
 * POST /api/one-on-one-counseling — public form submission
 */
exports.submitOneOnOneCounselingLead = async (req, res) => {
  try {
    const validated = validateSubmitBody(req.body || {});
    if (validated.error) {
      return res.status(400).json({ success: false, message: validated.error });
    }

    const doc = await OneOnOneCounselingLead.create(validated.data);

    return res.status(201).json({
      success: true,
      message: 'Submitted successfully',
      data: mapLeadToDTO(doc.toObject()),
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitOneOnOneCounselingLead]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

function buildSearchQuery(q) {
  if (!q) return null;
  const term = String(q).trim();
  if (!term) return null;
  const digits = term.replace(/\D/g, '');
  const clauses = [
    { studentName: { $regex: term, $options: 'i' } },
    { parentName: { $regex: term, $options: 'i' } },
    { entranceExamRank: { $regex: term, $options: 'i' } },
  ];
  if (digits.length >= 6) {
    clauses.push({ mobileNumber: { $regex: digits } });
    clauses.push({ parentMobileNumber: { $regex: digits } });
  } else if (digits.length > 0) {
    clauses.push({ mobileNumber: { $regex: digits } });
    clauses.push({ parentMobileNumber: { $regex: digits } });
  }
  return { $or: clauses };
}

/**
 * GET /api/admin/one-on-one-counseling-leads
 */
exports.listOneOnOneCounselingLeads = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const match = {};
    const dateRange = buildDateRange(req.query.from, req.query.to);
    if (dateRange) match.createdAt = dateRange;

    const searchQuery = buildSearchQuery(req.query.q);
    if (searchQuery) Object.assign(match, searchQuery);

    const filterFields = [
      ['leadStatus', LEAD_STATUS_OPTIONS],
      ['currentClass', CURRENT_CLASS_OPTIONS],
      ['interestedBranch', INTERESTED_BRANCH_OPTIONS],
      ['collegeBudget', COLLEGE_BUDGET_OPTIONS],
      ['biggestConcern', BIGGEST_CONCERN_OPTIONS],
      ['preferredLanguage', PREFERRED_LANGUAGE_OPTIONS],
      ['preferredTimeSlot', PREFERRED_TIME_SLOT_OPTIONS],
    ];

    for (const [key, allowed] of filterFields) {
      const val = typeof req.query[key] === 'string' ? req.query[key].trim() : '';
      if (val && allowed.includes(val)) match[key] = val;
    }

    const [rows, total] = await Promise.all([
      OneOnOneCounselingLead.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      OneOnOneCounselingLead.countDocuments(match),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data: rows.map(mapLeadToDTO),
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    console.error('[listOneOnOneCounselingLeads]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PATCH /api/admin/one-on-one-counseling-leads/:id
 */
exports.patchOneOnOneCounselingLead = async (req, res) => {
  try {
    const { id } = req.params;
    const leadStatus =
      typeof req.body?.leadStatus === 'string' ? req.body.leadStatus.trim() : '';

    if (!leadStatus) {
      return res.status(400).json({ success: false, message: 'leadStatus is required.' });
    }
    if (!LEAD_STATUS_OPTIONS.includes(leadStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid lead status.' });
    }

    const lead = await OneOnOneCounselingLead.findByIdAndUpdate(
      id,
      { leadStatus },
      { new: true, runValidators: true }
    ).lean();

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    return res.status(200).json({ success: true, data: mapLeadToDTO(lead) });
  } catch (err) {
    console.error('[patchOneOnOneCounselingLead]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
