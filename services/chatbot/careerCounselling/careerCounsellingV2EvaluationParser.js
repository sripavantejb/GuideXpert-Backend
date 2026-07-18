'use strict';

const { EVALUATION_FACTORS } = require('../../../constants/careerCounsellingV2Evaluation');
const { normalizeText } = require('../intentTextUtils');

const FACTOR_ALIASES = Object.freeze([
  { id: 'curriculum', patterns: [/\bcurriculum\b/i, /\bsyllabus\b/i, /\bcourses?\b/i, /\bsubject(s)?\b/i] },
  {
    id: 'projects',
    patterns: [/\bproject(s)?\b/i, /\bpractical\b/i, /\bhands[- ]?on\b/i, /\bexperiential\b/i],
  },
  {
    id: 'industry',
    patterns: [/\bindustry\b/i, /\binternship(s)?\b/i, /\bexposure\b/i, /\bindustrial\b/i],
  },
  {
    id: 'placements',
    patterns: [/\bplacement(s)?\b/i, /\bjob(s)?\b/i, /\bpackage(s)?\b/i, /\bcampus hiring\b/i],
  },
  {
    id: 'mentoring',
    patterns: [/\bmentor(ing|ship)?\b/i, /\bguidance\b/i, /\bcounsell?ing\b/i],
  },
  {
    id: 'faculty',
    patterns: [/\bfaculty\b/i, /\bteacher(s)?\b/i, /\bprofessor(s)?\b/i, /\bteaching\b/i],
  },
  {
    id: 'environment',
    patterns: [/\benvironment\b/i, /\bcampus culture\b/i, /\blearning environment\b/i, /\bculture\b/i],
  },
  {
    id: 'brand',
    patterns: [/\bbrand\b/i, /\branking(s)?\b/i, /\bfame\b/i, /\breputation\b/i, /\bnirf\b/i, /\bname\b/i],
  },
  {
    id: 'fees',
    patterns: [/\bfees?\b/i, /\bcost\b/i, /\bafford/i, /\bexpensive\b/i, /\bbudget\b/i],
  },
  {
    id: 'location',
    patterns: [/\blocation\b/i, /\bnearby\b/i, /\bclose to home\b/i, /\bdistance\b/i, /\bcity\b/i],
  },
]);

function labelForFactorId(id) {
  const found = EVALUATION_FACTORS.find((f) => f.id === id);
  return found ? found.label : id;
}

/**
 * Parse free-text priority answer into structured evaluation priorities.
 * @returns {{ evaluationPriorities: string[], studentPriorities: string[], evaluationConfidence: string } | null}
 */
function parseEvaluationPriorities(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const ids = [];
  for (const entry of FACTOR_ALIASES) {
    if (entry.patterns.some((re) => re.test(raw))) {
      if (!ids.includes(entry.id)) ids.push(entry.id);
    }
  }

  if (ids.length === 0) {
    // Accept free-text priorities when student describes what matters
    if (raw.length >= 8 && raw.length <= 400) {
      return {
        evaluationPriorities: ['custom'],
        studentPriorities: [raw.slice(0, 300)],
        evaluationConfidence: 'medium',
        rawAnswer: raw.slice(0, 500),
      };
    }
    return null;
  }

  const labels = ids.map(labelForFactorId);
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
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|clear|clearer|got it|makes sense|i understand)\b/i.test(
    t
  );
}

function isPermissionYes(text) {
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|y|continue|go ahead|absolutely|definitely|let'?s go)\b/i.test(
    t
  );
}

function isPermissionNo(text) {
  const t = normalizeText(text);
  return /^(no|nope|not now|later|nah|n|not yet)\b/i.test(t);
}

module.exports = {
  parseEvaluationPriorities,
  isEvaluationAcknowledgment,
  isEvaluationQuestion,
  isKnowledgeConfirmYes,
  isPermissionYes,
  isPermissionNo,
  labelForFactorId,
};
