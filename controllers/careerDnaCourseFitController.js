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

function normalizeOptionKey(str) {
  return trimAnswer(str)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019\u201C\u201D]/g, (c) => (c === '\u2019' || c === '\u2018' ? "'" : '"'));
}

function scoreMcq(userAnswer, correct) {
  if (!correct) return 0;
  return trimAnswer(userAnswer).toLowerCase() === correct.toLowerCase() ? 1 : 0;
}

/** Career DNA: option text -> category (TECH, SOCIAL, CREATIVE, RESEARCH). */
const CAREER_DNA_OPTION_TO_CATEGORY = {
  'solving problems or building things': 'TECH',
  'helping others or teaching': 'SOCIAL',
  'creating art, design, or content': 'CREATIVE',
  'analyzing data or researching': 'RESEARCH',
  'structured and predictable': 'TECH',
  'fast-paced and dynamic': 'CREATIVE',
  'collaborative and people-focused': 'SOCIAL',
  'independent and flexible': 'RESEARCH',
  'seeing a clear result or impact': 'TECH',
  'learning something new': 'RESEARCH',
  'working with a team': 'SOCIAL',
  'tackling a challenge': 'CREATIVE',
  'math, logic, or science': 'TECH',
  'languages, history, or social studies': 'SOCIAL',
  'arts, music, or design': 'CREATIVE',
  'a mix of many subjects': 'RESEARCH',
  'based on data and facts': 'TECH',
  'based on how it affects people': 'SOCIAL',
  'based on intuition and creativity': 'CREATIVE',
  'by discussing with others': 'RESEARCH',
  'technical or product impact': 'TECH',
  "direct impact on people's lives": 'SOCIAL',
  'creative or cultural impact': 'CREATIVE',
  'research or innovation impact': 'RESEARCH',
  'behind the scenes, building systems': 'TECH',
  'in front of people, guiding or leading': 'SOCIAL',
  'creating something new from scratch': 'CREATIVE',
  'exploring and discovering new ideas': 'RESEARCH',
  'break it into steps and solve it logically': 'TECH',
  'ask others for their views': 'SOCIAL',
  'try a creative or unusual approach': 'CREATIVE',
  'look for similar past cases or research': 'RESEARCH',
  'i like clarity and well-defined goals': 'TECH',
  'i like variety and trying new things': 'CREATIVE',
  'i like deep focus on one area': 'RESEARCH',
  'i like connecting ideas from different fields': 'SOCIAL',
  'job prospects and salary potential': 'TECH',
  'helping society or specific groups': 'SOCIAL',
  'personal interest and passion': 'CREATIVE',
  'scope for research and innovation': 'RESEARCH',
};

/** Course Fit: option text -> category (SCIENCE, COMMERCE, ARTS, RESEARCH, MIXED). */
const COURSE_FIT_OPTION_TO_CATEGORY = {
  'science (engineering, medicine, pure sciences)': 'SCIENCE',
  'commerce (business, finance, economics)': 'COMMERCE',
  'arts/humanities (literature, history, sociology)': 'ARTS',
  'still exploring multiple options': 'MIXED',
  'through experiments and hands-on work': 'SCIENCE',
  'through case studies and real examples': 'COMMERCE',
  'through reading and discussion': 'ARTS',
  'through a mix of all': 'MIXED',
  'exams with numerical or logical problems': 'SCIENCE',
  'projects and presentations': 'COMMERCE',
  'essays and long-form answers': 'ARTS',
  'a combination of these': 'MIXED',
  'technical or analytical skills': 'SCIENCE',
  'communication and leadership': 'COMMERCE',
  'creative or design skills': 'ARTS',
  'research and critical thinking': 'RESEARCH',
  'working in tech, healthcare, or core industry': 'SCIENCE',
  'working in business, finance, or management': 'COMMERCE',
  'working in arts, media, or social sector': 'ARTS',
  'pursuing higher studies or research': 'RESEARCH',
  'very important – i need clear boundaries': 'SCIENCE',
  'important but i can be flexible': 'COMMERCE',
  'i am okay with intense phases if the work is meaningful': 'ARTS',
  'it depends on the role': 'MIXED',
  'leading and organizing': 'COMMERCE',
  'doing the core technical or research work': 'SCIENCE',
  'presenting or communicating ideas': 'ARTS',
  'supporting and coordinating': 'MIXED',
  'i like following a structured curriculum': 'SCIENCE',
  'i like choosing my own focus areas': 'ARTS',
  'i like a balance of both': 'MIXED',
  'i am still figuring this out': 'MIXED',
  'strong placement and industry links': 'SCIENCE',
  'reputation and brand value': 'COMMERCE',
  'course content and faculty': 'RESEARCH',
  'campus life and peer group': 'ARTS',
  'it matches my strengths and interests': 'MIXED',
  'it opens the career options i want': 'COMMERCE',
  'it challenges me in the right way': 'SCIENCE',
  'it aligns with my values and goals': 'ARTS',
};

/** Career DNA: preferred option per question (for questionResults display). */
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

/** Course Fit: preferred option per question (for questionResults display). */
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

const CAREER_DNA_CATEGORIES = ['TECH', 'SOCIAL', 'CREATIVE', 'RESEARCH'];
const COURSE_FIT_CATEGORIES = ['SCIENCE', 'COMMERCE', 'ARTS', 'RESEARCH', 'MIXED'];

/** Career DNA result title per primary type. */
const CAREER_DNA_RESULT_TITLES = {
  TECH: 'The System Builder',
  SOCIAL: 'The Impact Creator',
  CREATIVE: 'The Visionary Maker',
  RESEARCH: 'The Strategic Thinker',
};

/** Career DNA: suggested career paths and courses per type. */
const CAREER_DNA_SUGGESTIONS = {
  TECH: {
    careerPaths: ['Engineering', 'Software & IT', 'Data Science', 'Product Management', 'Core technical roles'],
    courses: ['B.Tech / B.E.', 'Computer Science', 'Data Science', 'Information Technology', 'Electronics'],
  },
  SOCIAL: {
    careerPaths: ['Teaching', 'HR', 'Psychology', 'Civil services', 'Healthcare', 'Counseling'],
    courses: ['Psychology', 'Education', 'Social Work', 'Public Administration', 'Medicine / Nursing'],
  },
  CREATIVE: {
    careerPaths: ['Design', 'Media', 'Content creation', 'Branding', 'Arts & culture'],
    courses: ['Design', 'Mass Communication', 'Fine Arts', 'Film & Media', 'Fashion'],
  },
  RESEARCH: {
    careerPaths: ['Research', 'Policy', 'Economics', 'Innovation', 'Academia'],
    courses: ['Pure Sciences', 'Economics', 'Research programmes', 'PhD tracks', 'Policy studies'],
  },
};

/** Course Fit: recommended path and suggested courses per category. */
const COURSE_FIT_SUGGESTIONS = {
  SCIENCE: {
    recommendedPath: 'Engineering, Medicine, Pure Sciences, Data Science, Core Technical Degrees',
    courses: ['B.Tech / B.E.', 'MBBS / BDS', 'B.Sc. (Physics, Chemistry, Maths)', 'Data Science', 'Biotechnology'],
  },
  COMMERCE: {
    recommendedPath: 'Business, Finance, Economics, Management',
    courses: ['B.Com', 'BBA', 'Economics', 'Chartered Accountancy', 'Company Secretary'],
  },
  ARTS: {
    recommendedPath: 'Arts, Media, Humanities, Social sector',
    courses: ['BA (Humanities)', 'Journalism', 'Psychology', 'Sociology', 'Design'],
  },
  RESEARCH: {
    recommendedPath: 'Higher studies, Research, Academia',
    courses: ['M.Sc. / PhD', 'Research programmes', 'Policy studies', 'Economics (Hons)'],
  },
  MIXED: {
    recommendedPath: 'Multi-disciplinary or exploring options',
    courses: ['Liberal Arts', 'Integrated programmes', 'Dual degree', 'Explore before specialising'],
  },
};

function computeCategoryScores(answers, optionToCategoryMap) {
  const scores = {};
  if (!answers || typeof answers !== 'object' || !optionToCategoryMap) return scores;
  for (const qId of Object.keys(answers)) {
    const raw = answers[qId];
    const key = normalizeOptionKey(raw);
    const category = optionToCategoryMap[key];
    if (category) {
      scores[category] = (scores[category] || 0) + 1;
    }
  }
  return scores;
}

/** Sort categories by score descending; tie-break by fixed order. Returns [primary, secondary]. */
function getPrimaryAndSecondary(scoreBreakdown, categoryOrder) {
  const entries = categoryOrder.map((cat) => ({ category: cat, score: scoreBreakdown[cat] || 0 }));
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
  });
  const primary = entries[0]?.score > 0 ? entries[0].category : null;
  const secondary = entries[1]?.score > 0 ? entries[1].category : null;
  return { primary, secondary };
}

function computeScoreCareerDna(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE_CAREER_DNA };
  const breakdown = computeCategoryScores(answers, CAREER_DNA_OPTION_TO_CATEGORY);
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  return { score: total, maxScore: MAX_SCORE_CAREER_DNA };
}

function computeScoreCourseFit(answers) {
  if (!answers || typeof answers !== 'object') return { score: 0, maxScore: MAX_SCORE_COURSE_FIT };
  const breakdown = computeCategoryScores(answers, COURSE_FIT_OPTION_TO_CATEGORY);
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  return { score: total, maxScore: MAX_SCORE_COURSE_FIT };
}

function computeCareerDnaResult(answers) {
  const scoreBreakdown = { TECH: 0, SOCIAL: 0, CREATIVE: 0, RESEARCH: 0 };
  const breakdown = computeCategoryScores(answers, CAREER_DNA_OPTION_TO_CATEGORY);
  for (const [cat, n] of Object.entries(breakdown)) {
    scoreBreakdown[cat] = n;
  }
  const { primary, secondary } = getPrimaryAndSecondary(scoreBreakdown, CAREER_DNA_CATEGORIES);
  const resultTitle = primary ? CAREER_DNA_RESULT_TITLES[primary] : '';
  const primarySuggestions = primary ? CAREER_DNA_SUGGESTIONS[primary] : null;
  const secondarySuggestions = secondary ? CAREER_DNA_SUGGESTIONS[secondary] : null;
  const suggestedCareerPaths = primarySuggestions?.careerPaths || [];
  const suggestedCourses = [...(primarySuggestions?.courses || [])];
  if (secondarySuggestions?.courses?.length) {
    suggestedCourses.push(...secondarySuggestions.courses.slice(0, 2));
  }
  return {
    scoreBreakdown,
    primaryType: primary || '',
    secondaryType: secondary || '',
    resultTitle,
    suggestedCareerPaths,
    suggestedCourses: [...new Set(suggestedCourses)],
  };
}

function computeCourseFitResult(answers) {
  const scoreBreakdown = { SCIENCE: 0, COMMERCE: 0, ARTS: 0, RESEARCH: 0, MIXED: 0 };
  const breakdown = computeCategoryScores(answers, COURSE_FIT_OPTION_TO_CATEGORY);
  for (const [cat, n] of Object.entries(breakdown)) {
    scoreBreakdown[cat] = n;
  }
  const { primary, secondary } = getPrimaryAndSecondary(scoreBreakdown, COURSE_FIT_CATEGORIES);
  const primarySuggestions = primary ? COURSE_FIT_SUGGESTIONS[primary] : null;
  const recommendedPath = primarySuggestions?.recommendedPath || '';
  const suggestedCourses = primarySuggestions?.courses || [];
  return {
    scoreBreakdown,
    primaryType: primary || '',
    secondaryType: secondary || '',
    recommendedPath,
    suggestedCourses: [...suggestedCourses],
  };
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

function buildPayload(body, p, fullName, score, maxScore, counsellorId, extra = {}) {
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
    ...extra,
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
    const careerDnaResult = computeCareerDnaResult(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS_CAREER_DNA);
    const counsellorId = resolveCounsellorId(body.utm_content);
    const payload = buildPayload(body, p, fullName, score, maxScore, counsellorId, {
      scoreBreakdown: careerDnaResult.scoreBreakdown,
      primaryType: careerDnaResult.primaryType,
      secondaryType: careerDnaResult.secondaryType,
      resultTitle: careerDnaResult.resultTitle,
      suggestedCareerPaths: careerDnaResult.suggestedCareerPaths,
      suggestedCourses: careerDnaResult.suggestedCourses,
    });

    const doc = await CareerDnaSubmission.findOneAndUpdate(
      { phone: p },
      { $set: payload },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Psychometric assessment submitted successfully.',
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
    const courseFitResult = computeCourseFitResult(answers);
    const questionResults = getQuestionResults(answers, CORRECT_ANSWERS_COURSE_FIT);
    const counsellorId = resolveCounsellorId(body.utm_content);
    const payload = buildPayload(body, p, fullName, score, maxScore, counsellorId, {
      scoreBreakdown: courseFitResult.scoreBreakdown,
      primaryType: courseFitResult.primaryType,
      secondaryType: courseFitResult.secondaryType,
      recommendedPath: courseFitResult.recommendedPath,
      suggestedCourses: courseFitResult.suggestedCourses,
    });

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
