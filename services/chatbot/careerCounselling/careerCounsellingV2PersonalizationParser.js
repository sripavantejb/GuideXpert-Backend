'use strict';

const { normalizeText } = require('../intentTextUtils');

const CAREER_PRIORITY_PATTERNS = Object.freeze([
  { pattern: /\bplacement(s)?\b|\bpackage(s)?\b|\bjob(s)?\b/i, value: 'placements' },
  { pattern: /\bskill(s)?\b|\blearning\b|\bupskill/i, value: 'skill-building' },
  { pattern: /\bentrepreneur|\bstartup\b|\bbusiness\b/i, value: 'entrepreneurship' },
  { pattern: /\bresearch\b|\bphd\b|\bacademic\b/i, value: 'research' },
  { pattern: /\bgovernment\b|\bups?c\b|\bgovt\b/i, value: 'government jobs' },
  { pattern: /\bwork[- ]?life\b|\bbalance\b/i, value: 'work-life balance' },
  { pattern: /\bindustry\b|\bproduct\b|\bcore\b/i, value: 'industry roles' },
]);

const CONCERN_PATTERNS = Object.freeze([
  { pattern: /\bfee(s)?\b|\bcost\b|\bexpensive\b|\bbudget\b/i, value: 'fees' },
  { pattern: /\branch\b|\bwrong course\b|\bstream\b/i, value: 'branch choice' },
  { pattern: /\bplacement(s)?\b|\bjob(s)?\b/i, value: 'placements' },
  { pattern: /\bconfus/i, value: 'confusion' },
  { pattern: /\brank\b|\bcutoff\b/i, value: 'rank pressure' },
  { pattern: /\bpeer\b|\bfriend(s)?\b/i, value: 'peer pressure' },
  { pattern: /\bfamily\b|\bparent/i, value: 'family pressure' },
  { pattern: /\blocation\b|\bfar\b|\bhostel\b/i, value: 'location' },
]);

function matchFirst(text, patterns) {
  for (const entry of patterns) {
    if (entry.pattern.test(text)) return entry.value;
  }
  return null;
}

function parseCareerPriority(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;
  const structured = matchFirst(raw, CAREER_PRIORITY_PATTERNS);
  return {
    careerPriority: structured || raw.slice(0, 300),
    rawAnswer: raw.slice(0, 500),
  };
}

function parseLocationPreferences(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const relocationPreference = /\b(anywhere|open to (relocat|any)|willing to move|can relocate)\b/i.test(raw)
    ? 'open'
    : /\b(not (relocat|moving)|stay (near|close)|near home|no reloc)\b/i.test(raw)
      ? 'prefer_local'
      : /\brelocat|move (to|out)|other (city|state)\b/i.test(raw)
        ? 'willing'
        : null;

  const hostelRequired = /\bhostel\b/i.test(raw)
    ? !/\bno hostel\b|\bwithout hostel\b|\bday scholar\b/i.test(raw)
    : null;

  let preferredLocation = null;
  const locMatch = raw.match(
    /\b(in|at|near|around)\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\.|,|$| and| with| but)/i
  );
  if (locMatch) {
    preferredLocation = locMatch[2].trim().slice(0, 120);
  } else if (!/\b(anywhere|open to|hostel|relocat|home)\b/i.test(raw) && raw.length <= 120) {
    preferredLocation = raw.slice(0, 120);
  } else if (/\banywhere\b/i.test(raw)) {
    preferredLocation = 'Open / anywhere';
  } else {
    preferredLocation = raw.slice(0, 200);
  }

  return {
    preferredLocation,
    relocationPreference: relocationPreference || 'unspecified',
    hostelRequired,
    rawAnswer: raw.slice(0, 500),
  };
}

function parseBudgetPreferences(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  let budgetPreference = null;
  if (/\b(under|below|less than|<)\s*\d/i.test(raw) || /\b\d+\s*(lakh|lac|l)\b/i.test(raw)) {
    budgetPreference = raw.slice(0, 200);
  } else if (/\blow\b|\baffordable\b|\bcheap\b/i.test(raw)) {
    budgetPreference = 'lower / affordable range';
  } else if (/\bmid(dle)?\b|\bmoderate\b/i.test(raw)) {
    budgetPreference = 'mid range';
  } else if (/\bhigh\b|\bno (limit|issue)\b|\bflexible\b/i.test(raw)) {
    budgetPreference = 'flexible / higher range';
  } else {
    budgetPreference = raw.slice(0, 200);
  }

  let financialPreference = null;
  if (/\bscholarship/i.test(raw)) financialPreference = 'scholarship';
  else if (/\bloan\b/i.test(raw)) financialPreference = 'education loan';
  else if (/\bself[- ]?fund|parents? (will )?pay|family fund/i.test(raw)) {
    financialPreference = 'self / family funded';
  } else if (/\bmixed\b|\bcombination\b/i.test(raw)) {
    financialPreference = 'mixed';
  }

  return {
    budgetPreference,
    financialPreference,
    rawAnswer: raw.slice(0, 500),
  };
}

function parseFamilyPreferences(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const parentPreferences = raw.slice(0, 400);
  const constraints = [];
  if (/\bnearby\b|\bclose to home\b|\blocal\b/i.test(raw)) constraints.push('prefer nearby');
  if (/\bbrand\b|\branking\b|\bfamous\b/i.test(raw)) constraints.push('prefer brand');
  if (/\bsupport(ive|s my choice)?\b|\bmy choice\b/i.test(raw)) constraints.push('supportive of student choice');
  if (/\bstream\b|\bbranch\b|\bengineering\b|\bmedicine\b/i.test(raw)) {
    constraints.push('stream preference');
  }
  if (/\bfee(s)?\b|\bcost\b|\bbudget\b/i.test(raw)) constraints.push('cost sensitive');

  return {
    parentPreferences,
    familyConstraints: constraints,
    rawAnswer: raw.slice(0, 500),
  };
}

function parseConcerns(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;

  const concerns = [];
  for (const entry of CONCERN_PATTERNS) {
    if (entry.pattern.test(raw) && !concerns.includes(entry.value)) {
      concerns.push(entry.value);
    }
  }
  if (concerns.length === 0) {
    concerns.push(raw.slice(0, 200));
  }

  return {
    biggestConcerns: concerns.slice(0, 8),
    rawAnswer: raw.slice(0, 500),
  };
}

function isPersAcknowledgment(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /^(ok|okay|yes|yeah|yep|yup|sure|continue|go on|got it|understood|alright|fine|next|proceed|ready|let'?s go)$/i.test(
      t
    ) || /\b(make(s)? sense|sounds good|i (see|understand|agree)|ready to continue)\b/i.test(t)
  );
}

function isPersQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|who|can i|should i|tell me|explain)\b/i.test(t);
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

/**
 * Counseling confidence 0–100 from discovery + personalization completeness.
 */
function calculateCounselingConfidence(profile = {}) {
  let score = 0;
  const weights = [
    [Boolean(profile.currentQualification || profile.currentClass), 6],
    [Boolean(profile.preferredCourse), 8],
    [Boolean(profile.careerGoal), 8],
    [Boolean(profile.preferredLearningStyle), 8],
    [
      Array.isArray(profile.evaluationPriorities) && profile.evaluationPriorities.length > 0,
      8,
    ],
    [Boolean(profile.careerPriority), 12],
    [Boolean(profile.preferredLocation), 10],
    [profile.relocationPreference && profile.relocationPreference !== 'unspecified', 6],
    [profile.hostelRequired != null, 4],
    [Boolean(profile.budgetPreference), 10],
    [Boolean(profile.financialPreference), 4],
    [Boolean(profile.parentPreferences), 8],
    [Array.isArray(profile.biggestConcerns) && profile.biggestConcerns.length > 0, 8],
  ];

  for (const [ok, w] of weights) {
    if (ok) score += w;
  }

  return Math.min(100, score);
}

function getMissingClarifications(profile = {}) {
  const missing = [];
  if (!profile.careerPriority) missing.push({ key: 'career', step: 'pers_career_priority', messageKey: 'clarify_career' });
  if (!profile.preferredLocation) missing.push({ key: 'location', step: 'pers_location', messageKey: 'clarify_location' });
  if (!profile.budgetPreference) missing.push({ key: 'budget', step: 'pers_budget', messageKey: 'clarify_budget' });
  if (!profile.parentPreferences) missing.push({ key: 'family', step: 'pers_family', messageKey: 'clarify_family' });
  if (!Array.isArray(profile.biggestConcerns) || profile.biggestConcerns.length === 0) {
    missing.push({ key: 'concern', step: 'pers_concern', messageKey: 'clarify_concern' });
  }
  return missing;
}

module.exports = {
  parseCareerPriority,
  parseLocationPreferences,
  parseBudgetPreferences,
  parseFamilyPreferences,
  parseConcerns,
  isPersAcknowledgment,
  isPersQuestion,
  isPermissionYes,
  isPermissionNo,
  calculateCounselingConfidence,
  getMissingClarifications,
};
