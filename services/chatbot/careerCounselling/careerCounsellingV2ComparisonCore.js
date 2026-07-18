'use strict';

const {
  COMPARISON_DIMENSIONS,
  COMPARISON_ENGINE_VERSION,
} = require('../../../constants/careerCounsellingV2Comparison');

function hasProfileValue(profile, key) {
  const val = profile?.[key];
  if (Array.isArray(val)) return val.length > 0;
  return val != null && String(val).trim() !== '';
}

/**
 * Select only dimensions relevant to the student's stored profile.
 */
function selectComparisonDimensions(profile = {}) {
  const concerns = Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : [];
  const selected = [];

  for (const dim of COMPARISON_DIMENSIONS) {
    const keyHit = (dim.profileKeys || []).some((k) => hasProfileValue(profile, k));
    const concernHit = (dim.concernIds || []).some((c) => concerns.includes(c));
    if (keyHit || concernHit) selected.push(dim);
  }

  // Always keep at least course + one practical dimension when possible
  if (selected.length === 0) {
    selected.push(COMPARISON_DIMENSIONS.find((d) => d.id === 'course_fit'));
  }

  return selected.filter(Boolean).slice(0, 6);
}

function reasonForCollege(profile, collegeName) {
  const map = profile.recommendationReasons || {};
  return map[collegeName] || { why: [], strengths: [], consider: [] };
}

function feeLine(college) {
  if (college.fee == null) return null;
  return `Fee signal in eligibility data: ₹${Number(college.fee).toLocaleString('en-IN')}`;
}

function cutoffLine(college) {
  if (college.cutoff == null) return null;
  return `Eligible cutoff signal: ${college.cutoff}`;
}

function buildDimensionEvidence(college, profile, dim) {
  const reasons = reasonForCollege(profile, college.collegeName);
  const lines = [];

  switch (dim.id) {
    case 'course_fit':
      lines.push(
        `Preferred course on profile: ${profile.preferredCourse || 'n/a'}; option branch: ${college.branchName || 'n/a'}.`
      );
      if (reasons.why?.[0]) lines.push(reasons.why[0]);
      break;
    case 'career_goal':
      lines.push(`Career goal on profile: ${String(profile.careerGoal || '').slice(0, 100)}`);
      if (reasons.why?.find((w) => /career/i.test(w))) {
        lines.push(reasons.why.find((w) => /career/i.test(w)));
      }
      break;
    case 'career_priority':
      lines.push(`Career priority on profile: ${profile.careerPriority}`);
      break;
    case 'learning_style':
      lines.push(`Preferred learning style: ${profile.preferredLearningStyle}`);
      break;
    case 'budget': {
      lines.push(`Budget preference: ${profile.budgetPreference || profile.financialPreference || 'n/a'}`);
      const fee = feeLine(college);
      if (fee) lines.push(fee);
      if (reasons.consider?.find((c) => /fee|budget/i.test(c))) {
        lines.push(reasons.consider.find((c) => /fee|budget/i.test(c)));
      }
      break;
    }
    case 'location':
      lines.push(
        `Location preference: ${profile.preferredLocation || 'n/a'}; relocation: ${profile.relocationPreference || 'n/a'}`
      );
      if (reasons.why?.find((w) => /location/i.test(w))) {
        lines.push(reasons.why.find((w) => /location/i.test(w)));
      }
      if (reasons.consider?.find((c) => /location/i.test(c))) {
        lines.push(reasons.consider.find((c) => /location/i.test(c)));
      }
      break;
    case 'family':
      lines.push(
        `Family preferences: ${String(profile.parentPreferences || (profile.familyConstraints || []).join(', ') || 'n/a').slice(0, 120)}`
      );
      break;
    case 'evaluation_priorities': {
      const labels = Array.isArray(profile.studentPriorities)
        ? profile.studentPriorities
        : profile.evaluationPriorities || [];
      lines.push(`Evaluation priorities: ${(labels || []).slice(0, 4).join(', ') || 'n/a'}`);
      break;
    }
    case 'concerns':
      lines.push(`Concerns on profile: ${(profile.biggestConcerns || []).slice(0, 4).join(', ')}`);
      if (reasons.consider?.[0]) lines.push(reasons.consider[0]);
      break;
    default:
      break;
  }

  return [...new Set(lines.filter(Boolean))].slice(0, 3);
}

function scoreDimensionFit(college, profile, dim) {
  const reasons = reasonForCollege(profile, college.collegeName);
  let score = 0.5;

  if (dim.id === 'course_fit' && profile.preferredCourse && college.branchName) {
    const hay = String(college.branchName).toLowerCase();
    const course = String(profile.preferredCourse).toLowerCase();
    if (/cse|computer|it|information/.test(hay) && /eng|tech|cse|computer|software/.test(course)) {
      score = 0.85;
    } else if (hay) score = 0.6;
  }
  if (dim.id === 'budget' && college.fee != null && profile.budgetPreference) {
    const m = String(profile.budgetPreference).match(/(\d+(?:\.\d+)?)/);
    const lakhs = m ? Number(m[1]) * 100000 : null;
    if (lakhs && college.fee <= lakhs) score = 0.9;
    else if (lakhs && college.fee <= lakhs * 1.25) score = 0.55;
    else if (lakhs) score = 0.3;
  }
  if (dim.id === 'location' && profile.preferredLocation) {
    const pref = String(profile.preferredLocation).toLowerCase();
    const name = String(college.collegeName || '').toLowerCase();
    if (pref.split(/\s+/).some((t) => t.length > 3 && name.includes(t))) score = 0.9;
    else if (profile.relocationPreference === 'open' || /open|anywhere/i.test(pref)) score = 0.7;
    else score = 0.4;
  }
  if (dim.id === 'career_priority' || dim.id === 'career_goal') {
    if (reasons.why?.length) score = 0.75;
  }
  if (dim.id === 'concerns' && reasons.consider?.length) score = 0.45;
  if (college.tier === 'best_match') score = Math.min(1, score + 0.08);

  return score;
}

function buildCollegeCard(college, profile, dimensions) {
  const reasons = reasonForCollege(profile, college.collegeName);
  const whyFits = [];
  const strengths = [];
  const consider = [];

  for (const dim of dimensions) {
    const evidence = buildDimensionEvidence(college, profile, dim);
    const fit = scoreDimensionFit(college, profile, dim);
    if (evidence[0]) {
      if (fit >= 0.7) {
        whyFits.push(`${dim.label}: ${evidence[0]}`);
        if (evidence[1]) strengths.push(evidence[1]);
      } else if (fit <= 0.45) {
        consider.push(`${dim.label}: ${evidence[0]}`);
      } else {
        whyFits.push(`${dim.label}: ${evidence[0]}`);
      }
    }
  }

  if (whyFits.length === 0) {
    whyFits.push(
      reasons.why?.[0] ||
        `On your shortlist for ${profile.preferredCourse || 'your course interest'} and tied to your counseling priorities.`
    );
  }
  if (strengths.length === 0 && reasons.strengths?.[0]) strengths.push(reasons.strengths[0]);
  if (consider.length === 0) {
    if (reasons.consider?.[0]) consider.push(reasons.consider[0]);
    else if (profile.biggestConcerns?.length) {
      consider.push(
        `Keep your concerns in view (${profile.biggestConcerns.slice(0, 3).join(', ')}) while judging this option.`
      );
    } else {
      consider.push(
        `Validate campus fit against your priorities (${profile.careerPriority || profile.preferredCourse || 'as shared'}) before deciding.`
      );
    }
  }

  const cutoff = cutoffLine(college);
  if (cutoff && !consider.some((c) => /cutoff/i.test(c))) {
    // eligibility evidence — neutral strength
    strengths.push(cutoff);
  }

  const uniq = (arr) => [...new Set(arr)].slice(0, 4);
  const dimScores = Object.fromEntries(
    dimensions.map((d) => [d.id, scoreDimensionFit(college, profile, d)])
  );
  const overall =
    Object.values(dimScores).reduce((a, b) => a + b, 0) / Math.max(1, dimensions.length);

  return {
    collegeName: college.collegeName,
    branchName: college.branchName || null,
    tier: college.tier || null,
    whyFits: uniq(whyFits),
    strengths: uniq(strengths),
    consider: uniq(consider),
    dimScores,
    overallFit: Math.round(overall * 1000) / 1000,
  };
}

function analyzeTradeoffs(cards, profile, dimensions) {
  const tradeoffs = [];
  if (cards.length < 2) return tradeoffs;

  const [a, b] = cards;
  const budgetDim = dimensions.find((d) => d.id === 'budget');
  if (budgetDim && a.dimScores.budget != null && b.dimScores.budget != null) {
    if (Math.abs(a.dimScores.budget - b.dimScores.budget) >= 0.2) {
      const better = a.dimScores.budget >= b.dimScores.budget ? a.collegeName : b.collegeName;
      tradeoffs.push(
        `Budget trade-off: ${better} aligns more closely with your budget preference (${profile.budgetPreference || 'as shared'}).`
      );
    }
  }

  const locDim = dimensions.find((d) => d.id === 'location');
  if (locDim && a.dimScores.location != null && b.dimScores.location != null) {
    if (Math.abs(a.dimScores.location - b.dimScores.location) >= 0.2) {
      const better = a.dimScores.location >= b.dimScores.location ? a.collegeName : b.collegeName;
      tradeoffs.push(
        `Location trade-off: ${better} better matches your location preference (${profile.preferredLocation || 'as shared'}).`
      );
    }
  }

  if (a.overallFit !== b.overallFit) {
    const lead = a.overallFit >= b.overallFit ? a : b;
    const other = lead === a ? b : a;
    tradeoffs.push(
      `Fit trade-off: ${lead.collegeName} is a closer overall match to your stored priorities; ${other.collegeName} remains viable if you weight ${other.consider[0] ? 'its stated considerations' : 'other factors'} more heavily.`
    );
  }

  if (tradeoffs.length === 0) {
    tradeoffs.push(
      'These options are close on your profile dimensions — the gap is smaller than the difference in your priorities themselves.'
    );
  }

  return tradeoffs.slice(0, 4);
}

function generatePersonalizedVerdict(cards, profile) {
  const sorted = [...cards].sort((x, y) => y.overallFit - x.overallFit);
  const preferred = sorted[0];
  const runner = sorted[1];

  const decisionReasons = [
    `Closest overall fit to your counseling profile (course: ${profile.preferredCourse || 'n/a'}, priority: ${profile.careerPriority || 'n/a'}).`,
  ];
  if (preferred.whyFits[0]) decisionReasons.push(preferred.whyFits[0]);
  if (profile.biggestConcerns?.length) {
    decisionReasons.push(
      `Checked against your concerns (${profile.biggestConcerns.slice(0, 3).join(', ')}).`
    );
  }
  if (runner) {
    decisionReasons.push(
      `${runner.collegeName} stays a strong alternative if you prioritize different trade-offs.`
    );
  }

  const verdict = [
    `*${preferred.collegeName}*${preferred.branchName ? ` (${preferred.branchName})` : ''} looks like the stronger fit for you right now.`,
    runner
      ? `${runner.collegeName} is a solid alternative depending on the trade-offs above.`
      : '',
    'Decision support — not a final admission call.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    preferredCollege: preferred.collegeName,
    preferredBranch: preferred.branchName || null,
    verdict,
    decisionReasons: [...new Set(decisionReasons)].slice(0, 5),
  };
}

function calculateDecisionConfidence(profile, cards, preferredCollege) {
  let score = 35;
  const counseling = Number(profile.counselingConfidenceScore);
  if (Number.isFinite(counseling)) score += Math.round(counseling * 0.25);
  const rec = Number(profile.recommendationConfidence);
  if (Number.isFinite(rec)) score += Math.round(rec * 0.15);
  if (cards.length >= 2) score += 8;
  if (cards.length >= 3) score += 4;
  const preferred = cards.find((c) => c.collegeName === preferredCollege);
  if (preferred?.overallFit >= 0.75) score += 12;
  else if (preferred?.overallFit >= 0.6) score += 8;
  else if (preferred?.overallFit >= 0.45) score += 4;
  const gap =
    cards.length >= 2
      ? Math.abs((cards[0]?.overallFit || 0) - (cards[1]?.overallFit || 0))
      : 0;
  if (gap >= 0.12) score += 8;
  else if (gap >= 0.05) score += 4;
  if (profile.preferredCourse && profile.careerPriority && profile.budgetPreference) score += 6;
  return Math.max(0, Math.min(100, score));
}

function runComparison(profile, selectedColleges) {
  const dimensions = selectComparisonDimensions(profile);
  const cards = selectedColleges.map((c) => buildCollegeCard(c, profile, dimensions));
  const tradeoffs = analyzeTradeoffs(cards, profile, dimensions);
  const verdict = generatePersonalizedVerdict(cards, profile);
  const decisionConfidence = calculateDecisionConfidence(
    profile,
    cards,
    verdict.preferredCollege
  );

  return {
    dimensions,
    cards,
    tradeoffs,
    verdict,
    decisionConfidence,
    engineVersion: COMPARISON_ENGINE_VERSION,
  };
}

module.exports = {
  COMPARISON_ENGINE_VERSION,
  selectComparisonDimensions,
  buildCollegeCard,
  analyzeTradeoffs,
  generatePersonalizedVerdict,
  calculateDecisionConfidence,
  runComparison,
  reasonForCollege,
};
