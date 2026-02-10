const otpStore = require('../utils/otpStore');
const otpRepository = require('../utils/otpRepository');
const AssessmentSubmission = require('../models/AssessmentSubmission');
const AssessmentSubmission2 = require('../models/AssessmentSubmission2');
const VerifiedPhoneSession = require('../models/VerifiedPhoneSession');

const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min

const MAX_SCORE = 10;

/** Correct answers for MCQs (exact option text, trim for comparison). */
const CORRECT_ANSWERS = {
  q1: 'To guide students based on their needs and suitability',
  q2: 'Counsellor explains all suitable options ethically',
  q3: 'A structured conversation',
  q5: 'Giving false guarantees',
  q6: 'Because wrong guidance affects student futures',
  q7: 'Explain the risk and guide properly',
  q9: 'Referrals and personal networks',
  q10: 'Build rapport and understand needs',
  q12: 'To save time and ensure right fit',
  q13: 'Student with no clarity and urgency pressure'
};

const MAX_SCORE_2 = 15;

/** Correct answers for Assessment 2 (q1–q15). */
const CORRECT_ANSWERS_2 = {
  q1: "Understanding the student's background",
  q2: 'Ask questions to understand interests and goals',
  q3: 'Explain the support process without guarantees',
  q4: 'Explain limitations and suggest suitable alternatives',
  q5: 'Giving honest and realistic guidance',
  q6: 'Listening and understanding student needs',
  q7: 'When there is no response after multiple follow-ups',
  q8: 'Providing clarity and guidance to students',
  q9: 'Admissions process and documentation',
  q10: 'Transparency and honest communication',
  q11: 'Identifying students who genuinely fit the program',
  q12: 'To protect students and save time',
  q13: 'To ensure the right person is involved in decisions',
  q14: 'It can break trust with one side',
  q15: 'Creating balance between parent and student expectations'
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
      maxScore: doc.maxScore
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
      maxScore: doc.maxScore
    });
  } catch (err) {
    console.error('[submitAssessment2]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
