const otpStore = require('../utils/otpStore');
const otpRepository = require('../utils/otpRepository');
const AssessmentSubmission = require('../models/AssessmentSubmission');
const AssessmentSubmission2 = require('../models/AssessmentSubmission2');
const AssessmentSubmission3 = require('../models/AssessmentSubmission3');
const VerifiedPhoneSession = require('../models/VerifiedPhoneSession');

const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min

const MAX_SCORE = 10;

/** Correct answers for Training Assessment - 1 (q1–q10, exact option text). */
const CORRECT_ANSWERS = {
  q1: 'B. Help students with honest, ethical and personalised career guidance',
  q2: 'C. Sharing facts only',
  q3: 'A. Suggesting options or recommendations',
  q4: 'C. Help students make informed decisions',
  q5: 'B. Listening and asking questions',
  q6: 'D. Admissions depend on eligibility, seat availability, and university criteria',
  q7: 'B. Placements depend on student skills, companies visiting, and past records',
  q8: 'C. Acknowledge both views and suggest balanced options',
  q9: 'B. Acknowledge → Validate → Balance → Guide',
  q10: 'C. Calm and guiding tone'
};

const MAX_SCORE_2 = 10;

/** Correct answers for Assessment 2 (q1–q10). */
const CORRECT_ANSWERS_2 = {
  q1: 'Social Media',
  q2: 'Post consistently',
  q3: 'Curiosity and self-reflection',
  q4: 'Higher lead generation',
  q5: 'Personal network',
  q6: 'Start casual conversations about students',
  q7: 'One lead can bring many more leads',
  q8: 'Student career confusion after Intermediate',
  q9: 'I want to help your students',
  q10: 'Short-term enquiries and low trust'
};

const MAX_SCORE_3 = 20;

/** Correct answers for Assessment 3 (q1–q20). */
const CORRECT_ANSWERS_3 = {
  q1: 'Help students make informed decisions',
  q2: "Student's long-term goals and interests",
  q3: 'Help them explore options systematically',
  q4: 'Student profile analysis',
  q5: 'Review details and plan the conversation',
  q6: 'Identifying seriousness and readiness',
  q7: 'Follow structured follow-up process',
  q8: 'Budget, timeline, and goal',
  q9: 'Allowing student to speak without interruption',
  q10: 'Respond with clear and accurate information',
  q11: 'Understand the concern fully',
  q12: 'Clear agreed next step',
  q13: 'Better tracking and follow-up',
  q14: 'Important discussion summary and next action',
  q15: 'Guide through documentation and payment steps',
  q16: 'Verified properly before status update',
  q17: 'Following defined counselling process',
  q18: 'Verify and respond correctly',
  q19: 'Clear communication',
  q20: 'Structured process + student clarity'
};

function normalizePhone(phone) {
  return otpRepository.normalize(phone);
}

function trimAnswer(val) {
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * Score MCQ: 1 point if answer matches correct (case-insensitive trim).
 */
function scoreMcq(userAnswer, correct) {
  if (!correct) return 0;
  return trimAnswer(userAnswer).toLowerCase() === correct.toLowerCase() ? 1 : 0;
}

/**
 * Compute total score from answers object.
 */
function computeScore(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE };
  let score = 0;
  for (const [qId, correct] of Object.entries(CORRECT_ANSWERS)) {
    if (correct) {
      score += scoreMcq(answers[qId], correct);
    }
  }
  return { score, maxScore: MAX_SCORE };
}

function computeScore2(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE_2 };
  let score = 0;
  for (const [qId, correct] of Object.entries(CORRECT_ANSWERS_2)) {
    if (correct) {
      score += scoreMcq(answers[qId], correct);
    }
  }
  return { score, maxScore: MAX_SCORE_2 };
}

/**
 * Returns per-question results for feedback/report.
 * @param {Object} answers - User answers keyed by question id
 * @param {Object} correctAnswersMap - Map of questionId -> correct answer text
 * @returns {Array<{ questionId: string, correct: boolean, userAnswer: string, correctAnswer: string }>}
 */
function getQuestionResults(answers, correctAnswersMap) {
  if (!answers || typeof answers !== 'object' || !correctAnswersMap) return [];
  const results = [];
  for (const [qId, correctAnswer] of Object.entries(correctAnswersMap)) {
    if (correctAnswer == null) continue;
    const userAnswer = trimAnswer(answers[qId] ?? '');
    const correct = scoreMcq(userAnswer, correctAnswer) === 1;
    results.push({
      questionId: qId,
      correct,
      userAnswer: userAnswer || '',
      correctAnswer: String(correctAnswer).trim()
    });
  }
  return results;
}

function computeScore3(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE_3 };
  let score = 0;
  for (const [qId, correct] of Object.entries(CORRECT_ANSWERS_3)) {
    if (correct) {
      score += scoreMcq(answers[qId], correct);
    }
  }
  return { score, maxScore: MAX_SCORE_3 };
}

exports.getQuestionResults = getQuestionResults;
exports.CORRECT_ANSWERS = CORRECT_ANSWERS;
exports.CORRECT_ANSWERS_2 = CORRECT_ANSWERS_2;
exports.CORRECT_ANSWERS_3 = CORRECT_ANSWERS_3;

exports.submitAssessment = async (req, res) => {
  try {
    const { name, phone, answers } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const fullName = name.trim();
    if (fullName.length < 2) {
      return res.status(400).json({ success: false, message: 'name must be at least 2 characters' });
    }

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const inMemoryVerified = otpStore.isVerified(p);
    if (!inMemoryVerified) {
      const since = new Date(Date.now() - VERIFIED_TTL_MS);
      const session = await VerifiedPhoneSession.findOne({ phone: p, verifiedAt: { $gte: since } }).lean();
      if (!session) {
        return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
      }
    }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'answers object is required' });
    }

    const { score, maxScore } = computeScore(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS);

    const payload = {
      fullName,
      phone: p,
      answers,
      score,
      maxScore,
      submittedAt: new Date(),
      updatedAt: new Date()
    };

    const doc = await AssessmentSubmission.findOneAndUpdate(
      { phone: p },
      { $set: payload },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Assessment submitted successfully.',
      score: doc.score,
      maxScore: doc.maxScore,
      questionResults
    });
  } catch (err) {
    console.error('[submitAssessment]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.submitAssessment2 = async (req, res) => {
  try {
    const { name, phone, answers } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const fullName = name.trim();
    if (fullName.length < 2) {
      return res.status(400).json({ success: false, message: 'name must be at least 2 characters' });
    }

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const inMemoryVerified = otpStore.isVerified(p);
    if (!inMemoryVerified) {
      const since = new Date(Date.now() - VERIFIED_TTL_MS);
      const session = await VerifiedPhoneSession.findOne({ phone: p, verifiedAt: { $gte: since } }).lean();
      if (!session) {
        return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
      }
    }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'answers object is required' });
    }

    const { score, maxScore } = computeScore2(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS_2);

    const payload = {
      fullName,
      phone: p,
      answers,
      score,
      maxScore,
      submittedAt: new Date(),
      updatedAt: new Date()
    };

    const doc = await AssessmentSubmission2.findOneAndUpdate(
      { phone: p },
      { $set: payload },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Assessment 2 submitted successfully.',
      score: doc.score,
      maxScore: doc.maxScore,
      questionResults
    });
  } catch (err) {
    console.error('[submitAssessment2]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.submitAssessment3 = async (req, res) => {
  try {
    const { name, phone, answers } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const fullName = name.trim();
    if (fullName.length < 2) {
      return res.status(400).json({ success: false, message: 'name must be at least 2 characters' });
    }

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const p = normalizePhone(phone);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const inMemoryVerified = otpStore.isVerified(p);
    if (!inMemoryVerified) {
      const since = new Date(Date.now() - VERIFIED_TTL_MS);
      const session = await VerifiedPhoneSession.findOne({ phone: p, verifiedAt: { $gte: since } }).lean();
      if (!session) {
        return res.status(400).json({ success: false, message: 'Phone number must be verified first.' });
      }
    }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'answers object is required' });
    }

    const { score, maxScore } = computeScore3(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS_3);

    const payload = {
      fullName,
      phone: p,
      answers,
      score,
      maxScore,
      submittedAt: new Date(),
      updatedAt: new Date()
    };

    const doc = await AssessmentSubmission3.findOneAndUpdate(
      { phone: p },
      { $set: payload },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Assessment 3 submitted successfully.',
      score: doc.score,
      maxScore: doc.maxScore,
      questionResults
    });
  } catch (err) {
    console.error('[submitAssessment3]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
