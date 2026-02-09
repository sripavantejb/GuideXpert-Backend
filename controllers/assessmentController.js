const otpStore = require('../utils/otpStore');
const otpRepository = require('../utils/otpRepository');
const AssessmentSubmission = require('../models/AssessmentSubmission');
const VerifiedPhoneSession = require('../models/VerifiedPhoneSession');

const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min

const MAX_SCORE = 12;

/** Correct answers for MCQs (exact option text, trim for comparison). Q11 is short answer, scored separately. */
const CORRECT_ANSWERS = {
  q1: 'To guide students based on their needs and suitability',
  q2: 'Counsellor explains all suitable options ethically',
  q3: 'A structured conversation',
  q5: 'Giving false guarantees',
  q6: 'Because wrong guidance affects student futures',
  q7: 'Explain the risk and guide properly',
  q9: 'Referrals and personal networks',
  q10: 'Build rapport and understand needs',
  q11: null, // short answer: award 2 if non-empty and reasonable length
  q12: 'To save time and ensure right fit',
  q13: 'Student with no clarity and urgency pressure'
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
 * Score Q11 (short answer): 2 points if non-empty and reasonable length (e.g. >= 10 chars).
 */
function scoreQ11(userAnswer) {
  const s = trimAnswer(userAnswer);
  if (!s) return 0;
  return s.length >= 10 ? 2 : 0;
}

/**
 * Compute total score from answers object.
 */
function computeScore(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE };
  let score = 0;
  for (const [qId, correct] of Object.entries(CORRECT_ANSWERS)) {
    const userVal = answers[qId];
    if (qId === 'q11') {
      score += scoreQ11(userVal);
    } else if (correct) {
      score += scoreMcq(userVal, correct);
    }
  }
  return { score, maxScore: MAX_SCORE };
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
