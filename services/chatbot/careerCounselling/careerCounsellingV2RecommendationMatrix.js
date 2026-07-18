'use strict';

const {
  RECOMMENDATION_WEIGHTS,
  RECOMMENDATION_MATRIX_VERSION,
  TIER_LIMITS,
} = require('../../../constants/careerCounsellingV2Shortlisting');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function pickPrimaryBranch(college) {
  const branches = Array.isArray(college?.branches) ? college.branches : [];
  return branches[0] || null;
}

function pickCutoff(branch) {
  if (!branch) return null;
  const rc = Array.isArray(branch.reservation_categories) ? branch.reservation_categories[0] : null;
  const cutoff = branch.cutoff ?? rc?.cutoff_rank ?? rc?.cutoff ?? rc?.cutoff_to ?? null;
  const n = Number(cutoff);
  return Number.isFinite(n) ? n : null;
}

function pickFee(branch) {
  if (!branch) return null;
  const fee = branch.fee ?? branch.min_fee ?? branch.max_fee ?? null;
  const n = Number(fee);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function courseKeywords(profile) {
  const raw = normalizeText(profile.preferredCourse || profile.careerGoal || '');
  const keys = [];
  if (/\bb\.?\s*tech\b|\bengineering\b|\bcse\b|\bece\b|\bit\b/.test(raw)) {
    keys.push('engineering', 'computer', 'cse', 'ece', 'information', 'tech');
  }
  if (/\bmbbs\b|\bmedicine\b|\bmedical\b/.test(raw)) keys.push('medicine', 'mbbs', 'medical');
  if (/\bcom\b|\bcommerce\b|\bbba\b/.test(raw)) keys.push('commerce', 'business', 'management');
  if (/\bsc\b|\bscience\b/.test(raw)) keys.push('science');
  if (keys.length === 0 && raw) keys.push(...raw.split(/\s+/).filter((w) => w.length > 3).slice(0, 4));
  return keys;
}

function scoreCourseMatch(college, profile) {
  const branch = pickPrimaryBranch(college);
  const hay = normalizeText(
    `${college?.college_name || ''} ${branch?.branch_name || ''} ${branch?.branch_code || ''}`
  );
  const keys = courseKeywords(profile);
  if (keys.length === 0) return { score: 0.45, note: null };
  const hits = keys.filter((k) => hay.includes(k));
  if (hits.length === 0) return { score: 0.25, note: null };
  const score = Math.min(1, 0.55 + hits.length * 0.15);
  return {
    score,
    note: `Aligns with your preferred course (${profile.preferredCourse || 'your stated course interest'}) via ${branch?.branch_name || branch?.branch_code || 'an eligible branch'}.`,
  };
}

function scoreCareerGoal(college, profile) {
  const goal = normalizeText(profile.careerGoal || profile.careerPriority || '');
  if (!goal) return { score: 0.4, note: null };
  const branch = pickPrimaryBranch(college);
  const hay = normalizeText(`${branch?.branch_name || ''} ${college?.college_name || ''}`);
  let score = 0.4;
  if (/\bsoftware|product|ai|data|it|computer/.test(goal) && /\bcomputer|cse|it|data|ai|information/.test(hay)) {
    score = 0.9;
  } else if (/\bcore|mechanical|civil|electrical/.test(goal) && /\bmech|civil|electrical|eee/.test(hay)) {
    score = 0.85;
  } else if (hay.length > 0) {
    score = 0.5;
  }
  return {
    score,
    note:
      score >= 0.7
        ? `Supports your career direction (${String(profile.careerGoal || profile.careerPriority).slice(0, 80)}).`
        : null,
  };
}

function scoreEvaluationPriorities(college, profile) {
  const priorities = Array.isArray(profile.evaluationPriorities) ? profile.evaluationPriorities : [];
  const labels = Array.isArray(profile.studentPriorities) ? profile.studentPriorities : [];
  if (priorities.length === 0 && labels.length === 0) return { score: 0.4, note: null };

  // Soft signal: eligible options that remain after filters already respect practical evaluation;
  // boost slightly when student prioritizes projects/industry/mentoring (curiosity fit).
  const modernLean = priorities.some((p) =>
    ['projects', 'industry', 'mentoring', 'curriculum', 'placements'].includes(p)
  );
  const score = modernLean ? 0.7 : 0.5;
  return {
    score,
    note: `Kept in consideration against your evaluation priorities (${(labels.length ? labels : priorities)
      .slice(0, 3)
      .join(', ')}).`,
  };
}

function scoreLearningStyle(college, profile) {
  const style = normalizeText(profile.preferredLearningStyle || '');
  if (!style) return { score: 0.4, note: null };
  // Without college pedagogy metadata, use a neutral-positive score and explain via student preference only.
  const score =
    style.includes('hands') || style.includes('industry') || style.includes('project') ? 0.65 : 0.5;
  return {
    score,
    note: `Compatible with exploring options given your preferred learning style (${profile.preferredLearningStyle}).`,
  };
}

function parseBudgetCeiling(budgetPreference) {
  const raw = String(budgetPreference || '');
  const lakh = raw.match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(lakh|lac|l)\b/i);
  if (lakh) {
    const a = Number(lakh[1]);
    const b = lakh[2] ? Number(lakh[2]) : a;
    return Math.max(a, b) * 100000;
  }
  const num = raw.match(/(\d{5,7})/);
  if (num) return Number(num[1]);
  if (/low|affordable|cheap/i.test(raw)) return 150000;
  if (/mid|moderate/i.test(raw)) return 300000;
  if (/flex|high|no (limit|issue)/i.test(raw)) return null;
  return null;
}

function scoreBudget(college, profile) {
  const branch = pickPrimaryBranch(college);
  const fee = pickFee(branch);
  const ceiling = parseBudgetCeiling(profile.budgetPreference);
  if (fee == null || ceiling == null) {
    return {
      score: profile.budgetPreference ? 0.55 : 0.4,
      note: profile.budgetPreference
        ? `Kept with your budget preference in mind (${String(profile.budgetPreference).slice(0, 60)})${fee == null ? ' — fee not confirmed in eligibility data' : ''}.`
        : null,
    };
  }
  if (fee <= ceiling) {
    return {
      score: 0.9,
      note: `Fee signal (${fee.toLocaleString('en-IN')}) fits within your budget preference (${String(profile.budgetPreference).slice(0, 60)}).`,
    };
  }
  if (fee <= ceiling * 1.25) {
    return {
      score: 0.55,
      note: `Fee is slightly above your stated budget preference — flagged as something to consider.`,
    };
  }
  return { score: 0.25, note: `Fee appears above your stated budget preference — treat cautiously.` };
}

function scoreLocation(college, profile) {
  const pref = normalizeText(profile.preferredLocation || '');
  if (!pref || pref.includes('anywhere') || pref.includes('open')) {
    return {
      score: 0.75,
      note: profile.relocationPreference === 'open' || /anywhere|open/i.test(pref)
        ? `Fits your openness on location (${profile.preferredLocation || 'open / anywhere'}).`
        : null,
    };
  }
  const hay = normalizeText(
    `${college?.college_name || ''} ${college?.college_address || ''} ${college?.district_enum || ''}`
  );
  const tokens = pref.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const hits = tokens.filter((t) => hay.includes(t));
  if (hits.length > 0) {
    return {
      score: 0.95,
      note: `Location signal matches your preference (${profile.preferredLocation}).`,
    };
  }
  if (profile.relocationPreference === 'open' || profile.relocationPreference === 'willing') {
    return {
      score: 0.6,
      note: `Outside your top location preference, but you indicated willingness to relocate.`,
    };
  }
  return {
    score: 0.35,
    note: `Location may not match your preference (${profile.preferredLocation}) — listed with that trade-off in mind.`,
  };
}

function scoreCareerPriority(college, profile) {
  const priority = normalizeText(profile.careerPriority || '');
  if (!priority) return { score: 0.4, note: null };
  const branch = pickPrimaryBranch(college);
  const hay = normalizeText(`${branch?.branch_name || ''} ${college?.college_name || ''}`);
  let score = 0.5;
  if (/placement|job|package/.test(priority)) score = 0.7;
  if (/skill|learning/.test(priority) && /computer|cse|it|ai|data/.test(hay)) score = 0.8;
  return {
    score,
    note: `Considered against your career priority (${profile.careerPriority}).`,
  };
}

function scoreParentConstraints(college, profile) {
  const constraints = Array.isArray(profile.familyConstraints) ? profile.familyConstraints : [];
  const parent = normalizeText(profile.parentPreferences || '');
  if (constraints.length === 0 && !parent) return { score: 0.5, note: null };

  const hay = normalizeText(
    `${college?.college_name || ''} ${college?.college_address || ''}`
  );
  let score = 0.55;
  if (constraints.includes('prefer nearby') || /nearby|close to home|local/.test(parent)) {
    const pref = normalizeText(profile.preferredLocation || '');
    const localHit = pref && pref.split(/\s+/).some((t) => t.length > 2 && hay.includes(t));
    score = localHit ? 0.85 : 0.4;
  }
  if (constraints.includes('prefer brand') || /brand|ranking|famous/.test(parent)) {
    if (/\buniversity\b|\bnit\b|\biit\b|\bjntu\b|\bau\b/.test(hay)) score = Math.max(score, 0.8);
  }
  return {
    score,
    note: `Checked against family preferences you shared (${String(profile.parentPreferences || constraints.join(', ')).slice(0, 80)}).`,
  };
}

function scoreConcernMitigation(college, profile) {
  const concerns = Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : [];
  if (concerns.length === 0) return { score: 0.5, note: null };
  const branch = pickPrimaryBranch(college);
  const fee = pickFee(branch);
  let score = 0.55;
  const notes = [];
  if (concerns.includes('fees') && fee != null) {
    const ceiling = parseBudgetCeiling(profile.budgetPreference) || 300000;
    if (fee <= ceiling) {
      score = 0.85;
      notes.push('May ease your concern about fees relative to your budget preference');
    } else {
      score = 0.35;
      notes.push('May not fully ease your concern about fees');
    }
  }
  if (concerns.includes('branch choice') || concerns.includes('confusion')) {
    score = Math.max(score, 0.6);
    notes.push('Eligible branch clarity may help with your concern about branch choice / confusion');
  }
  if (concerns.includes('location') && profile.preferredLocation) {
    const loc = scoreLocation(college, profile);
    score = (score + loc.score) / 2;
  }
  return {
    score,
    note: notes[0] || `Reviewed with your concerns in mind (${concerns.slice(0, 3).join(', ')}).`,
  };
}

function weightedScore(parts, weights) {
  let totalW = 0;
  let acc = 0;
  for (const [key, part] of Object.entries(parts)) {
    const w = Number(weights[key]) || 0;
    if (w <= 0) continue;
    totalW += w;
    acc += w * Number(part.score || 0);
  }
  if (totalW <= 0) return 0;
  return Math.round((acc / totalW) * 1000) / 1000;
}

function buildReasons(college, profile, parts) {
  const why = [];
  const strengths = [];
  const consider = [];

  for (const part of Object.values(parts)) {
    if (!part?.note) continue;
    if (part.score >= 0.7) {
      why.push(part.note);
      strengths.push(part.note);
    } else if (part.score <= 0.4) {
      consider.push(part.note);
    } else {
      why.push(part.note);
    }
  }

  if (why.length === 0) {
    why.push(
      `Eligible for your exam/rank profile and kept because it intersects with your counseling preferences (course: ${profile.preferredCourse || 'n/a'}, priority: ${profile.careerPriority || 'n/a'}).`
    );
  }

  // Deduplicate
  const uniq = (arr) => [...new Set(arr)].slice(0, 4);
  return {
    why: uniq(why),
    strengths: uniq(strengths).slice(0, 3),
    consider: uniq(consider).slice(0, 3),
  };
}

/**
 * Score eligible colleges against counseling profile.
 * @param {object[]} colleges — predictor-eligible colleges
 * @param {object} profile
 * @param {object} [weights]
 */
function scoreEligibleColleges(colleges, profile, weights = RECOMMENDATION_WEIGHTS) {
  const list = Array.isArray(colleges) ? colleges : [];
  return list.map((college) => {
    const parts = {
      courseMatch: scoreCourseMatch(college, profile),
      careerGoalAlignment: scoreCareerGoal(college, profile),
      evaluationPriorities: scoreEvaluationPriorities(college, profile),
      learningStyleSignal: scoreLearningStyle(college, profile),
      budgetFit: scoreBudget(college, profile),
      locationFit: scoreLocation(college, profile),
      careerPrioritySignal: scoreCareerPriority(college, profile),
      parentConstraints: scoreParentConstraints(college, profile),
      concernMitigation: scoreConcernMitigation(college, profile),
    };
    const matchScore = weightedScore(parts, weights);
    const reasons = buildReasons(college, profile, parts);
    const branch = pickPrimaryBranch(college);
    return {
      collegeName: college.college_name || college.collegeName || 'College',
      collegeAddress: college.college_address || null,
      district: college.district_enum || null,
      branchName: branch?.branch_name || branch?.branch_code || null,
      branchCode: branch?.branch_code || null,
      cutoff: pickCutoff(branch),
      fee: pickFee(branch),
      matchScore,
      reasons,
      matrixParts: Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, { score: v.score }])
      ),
    };
  });
}

function tierRecommendations(scored) {
  const sorted = [...scored].sort((a, b) => b.matchScore - a.matchScore);
  const best = sorted.slice(0, TIER_LIMITS.bestMatch);
  const strong = sorted.slice(
    TIER_LIMITS.bestMatch,
    TIER_LIMITS.bestMatch + TIER_LIMITS.strongAlternatives
  );
  const explore = sorted.slice(
    TIER_LIMITS.bestMatch + TIER_LIMITS.strongAlternatives,
    TIER_LIMITS.bestMatch + TIER_LIMITS.strongAlternatives + TIER_LIMITS.worthExploring
  );
  return { bestMatch: best, strongAlternatives: strong, worthExploring: explore, allScored: sorted };
}

function calculateRecommendationConfidence(profile, tiers, eligibleCount) {
  let score = 40;
  const counseling = Number(profile.counselingConfidenceScore);
  if (Number.isFinite(counseling)) score += Math.round(counseling * 0.35);
  if (eligibleCount >= 10) score += 10;
  else if (eligibleCount >= 3) score += 6;
  else if (eligibleCount >= 1) score += 3;
  const top = tiers.bestMatch[0];
  if (top?.matchScore >= 0.75) score += 12;
  else if (top?.matchScore >= 0.6) score += 8;
  else if (top?.matchScore >= 0.45) score += 4;
  if (profile.preferredCourse && profile.careerPriority && profile.budgetPreference) score += 8;
  if (profile.exam && profile.rank) score += 6;
  return Math.max(0, Math.min(100, score));
}

module.exports = {
  RECOMMENDATION_MATRIX_VERSION,
  RECOMMENDATION_WEIGHTS,
  scoreEligibleColleges,
  tierRecommendations,
  calculateRecommendationConfidence,
  pickPrimaryBranch,
  pickCutoff,
  pickFee,
};
