'use strict';

const { normalizeText } = require('../intentTextUtils');

const SKIP_PATTERNS =
  /^(skip|pass|later|not sure|don't know|dont know|no idea|prefer not|maybe later|unsure)$/i;

const CORRECTION_PATTERNS =
  /\b(actually|correction|correct that|i meant|change my|update my|wrong|mistake)\b/i;

const SOCIAL_GREETING_ONLY =
  /^(hi|hello|hey|good morning|good afternoon|good evening|namaste|namaskar)[!.?\s]*$/i;

const LANGUAGE_MAP = Object.freeze([
  { pattern: /\b(english|en)\b/i, value: 'English' },
  { pattern: /\b(telugu|te)\b/i, value: 'Telugu' },
  { pattern: /\b(hindi|hi)\b/i, value: 'Hindi' },
  { pattern: /\b(tamil|ta)\b/i, value: 'Tamil' },
  { pattern: /\b(kannada|kn)\b/i, value: 'Kannada' },
  { pattern: /\b(malayalam|ml)\b/i, value: 'Malayalam' },
  { pattern: /\b(marathi|mr)\b/i, value: 'Marathi' },
  { pattern: /\b(bengali|bangla|bn)\b/i, value: 'Bengali' },
]);

const CLASS_PATTERNS = Object.freeze([
  { pattern: /\b(1st|first)\s*year\b/i, value: '1st year' },
  { pattern: /\b(2nd|second)\s*year\b/i, value: '2nd year' },
  { pattern: /\b(3rd|third)\s*year\b/i, value: '3rd year' },
  { pattern: /\b(4th|fourth)\s*year\b/i, value: '4th year' },
  { pattern: /\bclass\s*12\b|\b12th\b|\bxii\b|\bintermediate\b|\binter\b|\b\+2\b|\bplus two\b/i, value: 'Class 12' },
  { pattern: /\bclass\s*11\b|\b11th\b|\bxi\b/i, value: 'Class 11' },
  { pattern: /\bclass\s*10\b|\b10th\b|\bssc\b|\bmatric\b/i, value: 'Class 10' },
  { pattern: /\bgraduat(?:e|ed|ion)\b|\bdegree completed\b|\bcompleted degree\b/i, value: 'Graduation completed' },
  { pattern: /\bpost\s*graduat|\bpg\b|\bm\.?tech\b|\bm\.?ba\b|\bm\.?sc\b/i, value: 'Post graduation' },
  { pattern: /\bdiploma\b/i, value: 'Diploma' },
]);

const QUALIFICATION_PATTERNS = Object.freeze([
  { pattern: /\bb\.?\s*tech\b|\bb\.?\s*e\b|\bengineering student\b|\bbe\b/i, value: 'B.Tech / Engineering' },
  { pattern: /\bmbbs\b|\bmedicine\b|\bmedical\b/i, value: 'Medicine / MBBS' },
  { pattern: /\bb\.?\s*com\b|\bcommerce\b/i, value: 'Commerce' },
  { pattern: /\bb\.?\s*sc\b|\bscience\b/i, value: 'Science' },
  { pattern: /\barts\b|\bba\b|\bhumanities\b/i, value: 'Arts / Humanities' },
  { pattern: /\bmpc\b|\bbipc\b|\bintermediate\b|\binter\b|\b\+2\b/i, value: 'Intermediate (+2)' },
  { pattern: /\bclass\s*12\b|\b12th\b/i, value: 'Class 12' },
  { pattern: /\bclass\s*11\b|\b11th\b/i, value: 'Class 11' },
  { pattern: /\bclass\s*10\b|\b10th\b/i, value: 'Class 10' },
]);

const COURSE_PATTERNS = Object.freeze([
  { pattern: /\bb\.?\s*tech\b|\bengineering\b|\bbe\b|\bb\.?\s*e\b/i, value: 'B.Tech / Engineering' },
  { pattern: /\bmbbs\b|\bmedicine\b|\bmedical\b|\bbds\b/i, value: 'Medicine' },
  { pattern: /\bb\.?\s*com\b|\bcommerce\b|\bbba\b|\bb\.?\s*b\.?a\b/i, value: 'Commerce / Business' },
  { pattern: /\bb\.?\s*sc\b|\bscience degree\b/i, value: 'B.Sc / Science' },
  { pattern: /\barts\b|\bba\b|\bhumanities\b/i, value: 'Arts / Humanities' },
  { pattern: /\blaw\b|\ballb\b|\bllb\b/i, value: 'Law' },
  { pattern: /\barchitecture\b|\bb\.?\s*arch\b/i, value: 'Architecture' },
  { pattern: /\bpharmacy\b|\bb\.?\s*pharm\b/i, value: 'Pharmacy' },
  { pattern: /\bstill exploring\b|\bnot sure yet\b|\bexploring options\b/i, value: 'Still exploring' },
  { pattern: /\bcse\b|\bcomputer science\b|\bit\b|\bece\b|\beee\b|\bmech\b|\bcivil\b/i, value: 'Engineering (branch-specific)' },
]);

const NO_SHORTLIST_PATTERNS =
  /\b(no|none|not yet|haven't|havent|no college|not shortlisted|nothing yet|don't have|dont have)\b/i;

function isSkipResponse(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return SKIP_PATTERNS.test(t) || /^skip\b/i.test(t);
}

function isCorrectionResponse(text) {
  return CORRECTION_PATTERNS.test(String(text || ''));
}

function isSocialGreetingOnly(text) {
  return SOCIAL_GREETING_ONLY.test(String(text || '').trim());
}

function matchFirstPattern(text, patterns) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  for (const entry of patterns) {
    if (entry.pattern.test(raw)) return entry.value;
  }
  return null;
}

function parseQualificationAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const currentClass = matchFirstPattern(raw, CLASS_PATTERNS);
  const structuredQualification = matchFirstPattern(raw, QUALIFICATION_PATTERNS);

  if (structuredQualification || currentClass) {
    return {
      currentQualification: structuredQualification || raw.slice(0, 200),
      currentClass: currentClass || null,
      rawAnswer: raw.slice(0, 500),
    };
  }

  if (raw.length >= 3 && raw.length <= 300) {
    return {
      currentQualification: raw.slice(0, 200),
      currentClass: null,
      rawAnswer: raw.slice(0, 500),
    };
  }

  return null;
}

function parseCourseAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const structured = matchFirstPattern(raw, COURSE_PATTERNS);
  if (structured) return { preferredCourse: structured, rawAnswer: raw.slice(0, 500) };

  if (raw.length >= 2 && raw.length <= 300) {
    return { preferredCourse: raw.slice(0, 200), rawAnswer: raw.slice(0, 500) };
  }

  return null;
}

function parseCareerGoalAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 3) return null;
  if (isSkipResponse(raw)) return { careerGoal: null, skipped: true, rawAnswer: raw };
  return { careerGoal: raw.slice(0, 500), rawAnswer: raw.slice(0, 500) };
}

function parseShortlistAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  if (isSkipResponse(raw) || NO_SHORTLIST_PATTERNS.test(raw)) {
    return { preferredColleges: [], skipped: true, rawAnswer: raw };
  }

  const parts = raw
    .split(/[,;\n]|(?:\band\b)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  if (parts.length === 0) {
    return { preferredColleges: [raw.slice(0, 200)], rawAnswer: raw.slice(0, 500) };
  }

  return {
    preferredColleges: parts.slice(0, 10).map((p) => p.slice(0, 200)),
    rawAnswer: raw.slice(0, 500),
  };
}

function parseLanguageAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const mapped = matchFirstPattern(raw, LANGUAGE_MAP);
  if (mapped) return { preferredLanguage: mapped, rawAnswer: raw };

  if (raw.length >= 2 && raw.length <= 64) {
    return { preferredLanguage: raw.slice(0, 64), rawAnswer: raw.slice(0, 500) };
  }

  return null;
}

function detectCorrectionField(text, profile) {
  const t = String(text || '').toLowerCase();
  if (/\b(class|qualification|studying|inter|12th|11th|10th|year)\b/.test(t)) {
    return 'qualification';
  }
  if (/\b(course|branch|stream|b\.?tech|engineering|mbbs)\b/.test(t)) {
    return 'course';
  }
  if (/\b(career|goal|job|work)\b/.test(t)) {
    return 'career_goal';
  }
  if (/\b(college|university|shortlist)\b/.test(t)) {
    return 'shortlist';
  }
  if (/\b(language|telugu|hindi|english)\b/.test(t)) {
    return 'language';
  }
  if (profile?.step === 'awaiting_qualification') return 'qualification';
  return null;
}

module.exports = {
  isSkipResponse,
  isCorrectionResponse,
  isSocialGreetingOnly,
  parseQualificationAnswer,
  parseCourseAnswer,
  parseCareerGoalAnswer,
  parseShortlistAnswer,
  parseLanguageAnswer,
  detectCorrectionField,
};
