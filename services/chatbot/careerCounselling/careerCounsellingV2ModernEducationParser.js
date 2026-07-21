'use strict';

const { LEARNING_STYLES } = require('../../../constants/careerCounsellingV2ModernEducation');
const { normalizeText } = require('../intentTextUtils');

const STYLE_ALIASES = Object.freeze([
  {
    id: 'hands_on',
    patterns: [/\bhands[- ]?on\b/i, /\bproject(s)?\b/i, /\bpractical\b/i, /\bexperiential\b/i],
  },
  {
    id: 'industry_aligned',
    patterns: [/\bindustry\b/i, /\binternship(s)?\b/i, /\bjob[- ]?ready\b/i, /\bworkplace\b/i],
  },
  {
    id: 'balanced',
    patterns: [/\bbalanced?\b/i, /\bboth\b/i, /\btheory and practice\b/i, /\bmix(ed)?\b/i],
  },
  {
    id: 'theory_first',
    patterns: [/\btheory[- ]?first\b/i, /\btraditional\b/i, /\bacademic\b/i, /\bexam(s)?\b/i],
  },
  {
    id: 'mentored',
    patterns: [/\bmentor(ed|ing|ship)?\b/i, /\bguided\b/i, /\bguidance\b/i],
  },
  {
    id: 'exploring',
    patterns: [/\bexplor(e|ing)\b/i, /\bnot sure\b/i, /\bstill deciding\b/i, /\bopen\b/i],
  },
]);

function labelForStyleId(id) {
  const found = LEARNING_STYLES.find((s) => s.id === id);
  return found ? found.label : id;
}

/**
 * @returns {object|null}
 */
function parseLearningPreferences(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const matchedStyles = [];
  for (const entry of STYLE_ALIASES) {
    if (entry.patterns.some((re) => re.test(raw))) {
      if (!matchedStyles.includes(entry.id)) matchedStyles.push(entry.id);
    }
  }

  const projectInterest = /\bproject(s)?\b/i.test(raw);
  const portfolioInterest = /\bportfolio\b/i.test(raw);
  const internshipInterest = /\binternship(s)?\b/i.test(raw);
  const industryExposureInterest =
    /\bindustry\b/i.test(raw) || /\bexposure\b/i.test(raw) || internshipInterest;
  const futureSkillInterest =
    /\bfuture skill(s)?\b/i.test(raw) || /\bai\b/i.test(raw) || /\bemerging\b/i.test(raw) || /\bskill(s)?\b/i.test(raw);

  let preferredLearningStyle = null;
  let learningPreferences = [];

  if (matchedStyles.length > 0) {
    preferredLearningStyle = matchedStyles[0];
    learningPreferences = matchedStyles.map(labelForStyleId);
  } else if (raw.length >= 8 && raw.length <= 400) {
    preferredLearningStyle = 'custom';
    learningPreferences = [raw.slice(0, 300)];
  } else {
    return null;
  }

  return {
    learningPreferences,
    preferredLearningStyle,
    futureSkillInterest: Boolean(futureSkillInterest),
    industryExposureInterest: Boolean(industryExposureInterest),
    projectInterest: Boolean(projectInterest || matchedStyles.includes('hands_on')),
    portfolioInterest: Boolean(portfolioInterest),
    internshipInterest: Boolean(internshipInterest || matchedStyles.includes('industry_aligned')),
    rawAnswer: raw.slice(0, 500),
  };
}

function isModernAcknowledgment(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /^(ok|okay|yes|yeah|yep|yup|sure|continue|go on|got it|understood|hmm|hm|alright|fine|next|proceed|absolutely|definitely|makes sense|sounds good|i see|noted|ready|let'?s go|👍|✅)$/i.test(
      t
    ) || /\b(make(s)? sense|sounds good|i (see|understand|agree)|ready to continue|let'?s continue|resonates?)\b/i.test(t)
  );
}

function isModernQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|who|can i|should i|is it|are there|tell me|explain|difference|meaning|better)\b/i.test(
    t
  );
}

function isPermissionYes(text) {
  const { isPermissionAffirmative } = require('../permissionAffirmative');
  return isPermissionAffirmative(text);
}

function isPermissionNo(text) {
  const { isPermissionNegative } = require('../permissionAffirmative');
  return isPermissionNegative(text);
}

module.exports = {
  parseLearningPreferences,
  isModernAcknowledgment,
  isModernQuestion,
  isPermissionYes,
  isPermissionNo,
  labelForStyleId,
};
