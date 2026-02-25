const otpStore = require('../utils/otpStore');
const otpRepository = require('../utils/otpRepository');
const mongoose = require('mongoose');
const VerifiedPhoneSession = require('../models/VerifiedPhoneSession');
const CareerDnaSubmission = require('../models/CareerDnaSubmission');
const CourseFitSubmission = require('../models/CourseFitSubmission');

const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min

function normalizePhone(phone) {
  return otpRepository.normalize(phone);
}

function trimAnswer(val) {
  return typeof val === 'string' ? val.trim() : '';
}

function scoreMcq(userAnswer, correct) {
  if (!correct) return 0;
  return trimAnswer(userAnswer).toLowerCase() === correct.toLowerCase() ? 1 : 0;
}

/** Career DNA: preferred option per question (for scoring). */
const CORRECT_ANSWERS_CAREER_DNA = {
  cd1: 'Solving problems or building things',
  cd2: 'Structured and predictable',
  cd3: 'Seeing a clear result or impact',
  cd4: 'Math, logic, or science',
  cd5: 'Based on data and facts',
  cd6: 'Technical or product impact',
  cd7: 'Behind the scenes, building systems',
  cd8: 'Break it into steps and solve it logically',
  cd9: 'I like clarity and well-defined goals',
  cd10: 'Job prospects and salary potential',
};

/** Course Fit: preferred option per question. */
const CORRECT_ANSWERS_COURSE_FIT = {
  cf1: 'Science (Engineering, Medicine, Pure Sciences)',
  cf2: 'Through experiments and hands-on work',
  cf3: 'Exams with numerical or logical problems',
  cf4: 'Technical or analytical skills',
  cf5: 'Working in tech, healthcare, or core industry',
  cf6: 'Very important – I need clear boundaries',
  cf7: 'Leading and organizing',
  cf8: 'I like following a structured curriculum',
  cf9: 'Strong placement and industry links',
  cf10: 'It matches my strengths and interests',
};

const MAX_SCORE_CAREER_DNA = 10;
const MAX_SCORE_COURSE_FIT = 10;

function computeScoreCareerDna(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE_CAREER_DNA };
  let score = 0;
  for (const [qId, correct] of Object.entries(CORRECT_ANSWERS_CAREER_DNA)) {
    if (correct) score += scoreMcq(answers[qId], correct);
  }
  return { score, maxScore: MAX_SCORE_CAREER_DNA };
}

function computeScoreCourseFit(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE_COURSE_FIT };
  let score = 0;
  for (const [qId, correct] of Object.entries(CORRECT_ANSWERS_COURSE_FIT)) {
    if (correct) score += scoreMcq(answers[qId], correct);
  }
  return { score, maxScore: MAX_SCORE_COURSE_FIT };
}

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
      correctAnswer: String(correctAnswer).trim(),
    });
  }
  return results;
}

function resolveCounsellorId(utmContent) {
  if (!utmContent || typeof utmContent !== 'string') return null;
  const trimmed = utmContent.trim();
  if (!trimmed) return null;
  if (mongoose.Types.ObjectId.isValid(trimmed) && String(new mongoose.Types.ObjectId(trimmed)) === trimmed) {
    return new mongoose.Types.ObjectId(trimmed);
  }
  return null;
}

function buildPayload(body, p, fullName, score, maxScore, counsellorId) {
  const payload = {
    fullName,
    phone: p,
    answers: body.answers || {},
    score,
    maxScore,
    submittedAt: new Date(),
    email: (body.email && String(body.email).trim()) || '',
    school: (body.school && String(body.school).trim()) || '',
    class: (body.class && String(body.class).trim()) || '',
    counsellorId: counsellorId || null,
    utm_source: (body.utm_source && String(body.utm_source).trim()) || '',
    utm_medium: (body.utm_medium && String(body.utm_medium).trim()) || '',
    utm_campaign: (body.utm_campaign && String(body.utm_campaign).trim()) || '',
    utm_content: (body.utm_content && String(body.utm_content).trim()) || '',
  };
  return payload;
}

exports.submitCareerDna = async (req, res) => {
  try {
    const body = req.body || {};
    const { name, phone, answers } = body;

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

    const { score, maxScore } = computeScoreCareerDna(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS_CAREER_DNA);
    const counsellorId = resolveCounsellorId(body.utm_content);
    const payload = buildPayload(body, p, fullName, score, maxScore, counsellorId);

    const doc = await CareerDnaSubmission.findOneAndUpdate(
      { phone: p },
      { $set: payload },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Career DNA assessment submitted successfully.',
      data: {
        score: doc.score,
        maxScore: doc.maxScore,
        questionResults,
      },
    });
  } catch (err) {
    console.error('[submitCareerDna]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.submitCourseFit = async (req, res) => {
  try {
    const body = req.body || {};
    const { name, phone, answers } = body;

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

    const { score, maxScore } = computeScoreCourseFit(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS_COURSE_FIT);
    const counsellorId = resolveCounsellorId(body.utm_content);
    const payload = buildPayload(body, p, fullName, score, maxScore, counsellorId);

    const doc = await CourseFitSubmission.findOneAndUpdate(
      { phone: p },
      { $set: payload },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Course Fit assessment submitted successfully.',
      data: {
        score: doc.score,
        maxScore: doc.maxScore,
        questionResults,
      },
    });
  } catch (err) {
    console.error('[submitCourseFit]', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.CORRECT_ANSWERS_CAREER_DNA = CORRECT_ANSWERS_CAREER_DNA;
exports.CORRECT_ANSWERS_COURSE_FIT = CORRECT_ANSWERS_COURSE_FIT;
exports.getQuestionResultsCareerDna = (answers) => getQuestionResults(answers, CORRECT_ANSWERS_CAREER_DNA);
exports.getQuestionResultsCourseFit = (answers) => getQuestionResults(answers, CORRECT_ANSWERS_COURSE_FIT);
