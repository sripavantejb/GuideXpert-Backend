const CareerDnaSubmission = require('../models/CareerDnaSubmission');
const CourseFitSubmission = require('../models/CourseFitSubmission');
const {
  getQuestionResultsCareerDna,
  getQuestionResultsCourseFit,
} = require('./careerDnaCourseFitController');

const DEFAULT_FRONTEND_BASE = 'https://guidexpert.co.in';

function getFrontendBase() {
  const base = process.env.FRONTEND_URL || process.env.FRONTEND_BASE_URL || DEFAULT_FRONTEND_BASE;
  return base.replace(/\/?$/, '');
}

/**
 * Build UTM link for counsellor assessment (Career DNA or Course Fit).
 * utm_content = counsellorId so we can attribute submissions.
 */
function buildAssessmentLink(counsellorId, assessmentType) {
  const base = getFrontendBase();
  const path = assessmentType === 'career-dna' ? '/assessment-career-dna' : '/assessment-course-fit';
  const params = new URLSearchParams({
    utm_source: assessmentType,
    utm_medium: 'counsellor',
    utm_campaign: 'guidexpert',
    utm_content: String(counsellorId),
  });
  return `${base}${path}?${params.toString()}`;
}

/**
 * GET /api/counsellor/assessment-links
 * Returns the counsellor's unique UTM links for Career DNA and Course Fit.
 */
exports.getAssessmentLinks = async (req, res) => {
  try {
    const counsellor = req.counsellor;
    if (!counsellor || !counsellor._id) {
      return res.status(401).json({ success: false, message: 'Counsellor not found.' });
    }
    const counsellorId = counsellor._id;
    const careerDnaLink = buildAssessmentLink(counsellorId, 'career-dna');
    const courseFitLink = buildAssessmentLink(counsellorId, 'course-fit');
    return res.status(200).json({
      success: true,
      data: {
        careerDna: { link: careerDnaLink, title: 'Career DNA Test' },
        courseFit: { link: courseFitLink, title: 'Course Fit Test' },
      },
    });
  } catch (err) {
    console.error('[getAssessmentLinks]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/counsellor/assessment-results?type=career-dna|course-fit&page=1&limit=20
 * List submissions for the logged-in counsellor.
 */
exports.getAssessmentResults = async (req, res) => {
  try {
    const counsellor = req.counsellor;
    if (!counsellor || !counsellor._id) {
      return res.status(401).json({ success: false, message: 'Counsellor not found.' });
    }
    const type = (req.query.type || '').toLowerCase();
    if (type !== 'career-dna' && type !== 'course-fit') {
      return res.status(400).json({ success: false, message: 'Query type must be career-dna or course-fit.' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const counsellorId = counsellor._id;

    const Model = type === 'career-dna' ? CareerDnaSubmission : CourseFitSubmission;
    const [submissions, total] = await Promise.all([
      Model.find({ counsellorId })
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Model.countDocuments({ counsellorId }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        submissions,
        total,
        page,
        limit,
      },
    });
  } catch (err) {
    console.error('[getAssessmentResults]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/counsellor/assessment-results/:id?type=career-dna|course-fit
 * Single submission with question results; ensure counsellorId matches.
 */
exports.getAssessmentResultById = async (req, res) => {
  try {
    const counsellor = req.counsellor;
    if (!counsellor || !counsellor._id) {
      return res.status(401).json({ success: false, message: 'Counsellor not found.' });
    }
    const type = (req.query.type || '').toLowerCase();
    if (type !== 'career-dna' && type !== 'course-fit') {
      return res.status(400).json({ success: false, message: 'Query type must be career-dna or course-fit.' });
    }
    const id = req.params.id;
    const Model = type === 'career-dna' ? CareerDnaSubmission : CourseFitSubmission;
    const doc = await Model.findOne({
      _id: id,
      counsellorId: counsellor._id,
    }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    const getQuestionResults = type === 'career-dna' ? getQuestionResultsCareerDna : getQuestionResultsCourseFit;
    const questionResults = getQuestionResults(doc.answers || {});
    return res.status(200).json({
      success: true,
      data: {
        ...doc,
        questionResults,
      },
    });
  } catch (err) {
    console.error('[getAssessmentResultById]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
