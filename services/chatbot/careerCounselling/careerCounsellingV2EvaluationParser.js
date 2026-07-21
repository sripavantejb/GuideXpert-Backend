'use strict';

const {
  EVALUATION_FACTORS,
  COUNSELOR_SUGGESTED_PRIORITIES,
} = require('../../../constants/careerCounsellingV2Evaluation');
const { normalizeText } = require('../intentTextUtils');
const { isUnclearCounselingInput } = require('./careerCounsellingV2ResponseParser');

const FACTOR_ALIASES = Object.freeze([
  {
    id: 'placements',
    label: 'Placements',
    patterns: [/\bplacement(s)?\b/i, /\bjob(s)?\b/i, /\bpackage(s)?\b/i, /\bcampus hiring\b/i],
  },
  {
    id: 'projects',
    label: 'Coding Culture',
    patterns: [
      /\bcoding\b/i,
      /\bcoding culture\b/i,
      /\bproject(s)?\b/i,
      /\bpractical\b/i,
      /\bhands[- ]?on\b/i,
      /\bai\b/i,
      /\bartificial intelligence\b/i,
    ],
  },
  {
    id: 'industry',
    label: 'Internships',
    patterns: [/\binternship(s)?\b/i, /\bindustry\b/i, /\bexposure\b/i],
  },
  {
    id: 'fees',
    label: 'Affordable Fees',
    patterns: [/\bfees?\b/i, /\bcost\b/i, /\bafford/i, /\bexpensive\b/i, /\bbudget\b/i, /\bcheap\b/i],
  },
  {
    id: 'environment',
    label: 'Campus Life',
    patterns: [
      /\bcampus life\b/i,
      /\bcampus culture\b/i,
      /\bcampus\b/i,
      /\bhostel\b/i,
      /\benvironment\b/i,
      /\bculture\b/i,
    ],
  },
  {
    id: 'curriculum',
    label: 'Research',
    patterns: [/\bresearch\b/i, /\bcurriculum\b/i, /\bsyllabus\b/i],
  },
  {
    id: 'entrepreneurship',
    label: 'Entrepreneurship',
    patterns: [/\bentrepreneur/i, /\bstartup(s)?\b/i, /\bstart[- ]?up\b/i],
  },
  {
    id: 'higher_studies',
    label: 'Higher Studies',
    patterns: [/\bhigher stud/i, /\bms\b/i, /\bm\.?tech\b/i, /\bmasters?\b/i, /\babroad\b/i],
  },
  {
    id: 'location',
    label: 'Location',
    patterns: [/\blocation\b/i, /\bnearby\b/i, /\bclose to home\b/i, /\bcity\b/i, /\bdistance\b/i],
  },
  {
    id: 'mentoring',
    label: 'Mentorship',
    patterns: [/\bmentor(ing|ship)?\b/i, /\bguidance\b/i],
  },
  {
    id: 'faculty',
    label: 'Faculty',
    patterns: [/\bfaculty\b/i, /\bteacher(s)?\b/i, /\bprofessor(s)?\b/i],
  },
  {
    id: 'brand',
    label: 'Brand / Rankings',
    patterns: [/\bbrand\b/i, /\branking(s)?\b/i, /\bfame\b/i, /\breputation\b/i, /\bnirf\b/i],
  },
]);

function labelForFactorId(id) {
  const alias = FACTOR_ALIASES.find((f) => f.id === id);
  if (alias) return alias.label;
  const found = EVALUATION_FACTORS.find((f) => f.id === id);
  return found ? found.label : id;
}

function isDontKnowOrSuggest(text) {
  const t = normalizeText(text);
  return (
    /^(i )?don'?t know\b/i.test(t) ||
    /^(idk|no idea|not sure)\b/i.test(t) ||
    /\byou suggest\b/i.test(t) ||
    /\bsuggest (for )?me\b/i.test(t) ||
    /\byou (decide|choose|tell)\b/i.test(t) ||
    /^(anything|whatever|your choice)\b/i.test(t)
  );
}

/**
 * Parse free-text priority answer into structured evaluation priorities.
 */
function parseEvaluationPriorities(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  if (isDontKnowOrSuggest(raw)) {
    return {
      evaluationPriorities: COUNSELOR_SUGGESTED_PRIORITIES.map((p) => p.id),
      studentPriorities: COUNSELOR_SUGGESTED_PRIORITIES.map((p) => p.label),
      evaluationConfidence: 'suggested',
      suggestedByCounselor: true,
      rawAnswer: raw.slice(0, 500),
    };
  }

  const ids = [];
  const labels = [];
  for (const entry of FACTOR_ALIASES) {
    if (entry.patterns.some((re) => re.test(raw))) {
      if (!ids.includes(entry.id)) {
        ids.push(entry.id);
        labels.push(entry.label);
      }
    }
  }

  if (ids.length === 0) {
    if (isUnclearCounselingInput(raw)) return null;
    if (raw.length >= 3 && raw.length <= 400) {
      return {
        evaluationPriorities: ['custom'],
        studentPriorities: [raw.slice(0, 120)],
        evaluationConfidence: 'medium',
        rawAnswer: raw.slice(0, 500),
      };
    }
    return null;
  }

  return {
    evaluationPriorities: ids,
    studentPriorities: labels,
    evaluationConfidence: ids.length >= 2 ? 'high' : 'medium',
    rawAnswer: raw.slice(0, 500),
  };
}

function isEvaluationAcknowledgment(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /^(ok|okay|yes|yeah|yep|yup|sure|continue|go on|got it|understood|hmm|hm|alright|fine|next|proceed|absolutely|definitely|makes sense|sounds good|i see|noted|ready|let'?s go|👍|✅)$/i.test(
      t
    ) || /\b(make(s)? sense|sounds good|i (see|understand|agree)|ready to continue|let'?s continue)\b/i.test(t)
  );
}

function isEvaluationQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|who|can i|should i|is it|are there|tell me|explain|difference|meaning)\b/i.test(
    t
  );
}

function isKnowledgeConfirmYes(text) {
  const { isPermissionAffirmative, normalizePermissionText } = require('../permissionAffirmative');
  if (isPermissionAffirmative(text)) return true;
  const t = normalizePermissionText(text);
  return /^(clear|clearer|got it|makes sense|i understand)\b/i.test(t);
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
  parseEvaluationPriorities,
  isEvaluationAcknowledgment,
  isEvaluationQuestion,
  isKnowledgeConfirmYes,
  isPermissionYes,
  isPermissionNo,
  isDontKnowOrSuggest,
  labelForFactorId,
};
