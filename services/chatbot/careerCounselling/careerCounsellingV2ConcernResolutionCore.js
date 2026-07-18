'use strict';

const {
  CONCERN_CATEGORIES,
  CONCERN_ENGINE_VERSION,
  getCategoryById,
  normalizeConcernId,
} = require('../../../constants/careerCounsellingV2ConcernResolution');

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

/**
 * Map Phase 4 concern labels onto Phase 7 category ids.
 */
function mapLegacyConcern(raw) {
  const id = normalizeConcernId(raw);
  if (id) return id;
  const t = String(raw || '').toLowerCase();
  for (const cat of CONCERN_CATEGORIES) {
    if (cat.patterns.some((re) => re.test(t))) return cat.id;
  }
  return 'other';
}

function seedActiveConcerns(profile = {}) {
  const fromProfile = Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : [];
  const existing = Array.isArray(profile.activeConcerns) ? profile.activeConcerns : [];
  const resolved = new Set(Array.isArray(profile.resolvedConcerns) ? profile.resolvedConcerns : []);

  const seeded = uniq([
    ...existing.map(mapLegacyConcern),
    ...fromProfile.map(mapLegacyConcern),
  ]).filter((id) => !resolved.has(id));

  return seeded;
}

function classifyConcernText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  for (const cat of CONCERN_CATEGORIES) {
    if (cat.id === 'other') continue;
    if (cat.patterns.some((re) => re.test(raw))) {
      return { category: cat.id, label: cat.label, rawAnswer: raw.slice(0, 300) };
    }
  }

  const byId = normalizeConcernId(raw);
  if (byId && byId !== 'other') {
    const cat = getCategoryById(byId);
    return { category: cat.id, label: cat.label, rawAnswer: raw.slice(0, 300) };
  }

  return {
    category: 'other',
    label: getCategoryById('other').label,
    rawAnswer: raw.slice(0, 300),
  };
}

function pickEvidence(profile, category) {
  const reasons = profile.recommendationReasons || {};
  const preferred = profile.preferredCollege;
  const preferredReasons = preferred ? reasons[preferred] || {} : {};
  const compared = Array.isArray(profile.comparedColleges) ? profile.comparedColleges : [];
  const decisionReasons = Array.isArray(profile.decisionReasons) ? profile.decisionReasons : [];

  return {
    preferredCollege: preferred || null,
    preferredWhy: preferredReasons.why || [],
    preferredConsider: preferredReasons.consider || [],
    comparedNames: compared.map((c) => c.collegeName || c).filter(Boolean),
    comparisonSummary: profile.comparisonSummary || null,
    decisionReasons,
    budgetPreference: profile.budgetPreference || null,
    preferredLocation: profile.preferredLocation || null,
    relocationPreference: profile.relocationPreference || null,
    careerPriority: profile.careerPriority || null,
    preferredCourse: profile.preferredCourse || null,
    careerGoal: profile.careerGoal || null,
    parentPreferences: profile.parentPreferences || null,
    familyConstraints: profile.familyConstraints || [],
    preferredLearningStyle: profile.preferredLearningStyle || null,
    evaluationPriorities: profile.evaluationPriorities || [],
  };
}

function generatePersonalizedConcernResponse(profile, category, objectionText) {
  const cat = getCategoryById(category);
  const ev = pickEvidence(profile, category);
  const lines = [];

  lines.push(`*${cat.label}*`);
  lines.push('');

  switch (category) {
    case 'fees':
      lines.push(`Budget on profile: ${ev.budgetPreference || 'not set yet'}.`);
      if (ev.preferredCollege) {
        lines.push(`Your lean (${ev.preferredCollege}) already weighed fee fit.`);
      }
      if (ev.preferredConsider?.find((c) => /fee|budget/i.test(c))) {
        lines.push(`Note: ${ev.preferredConsider.find((c) => /fee|budget/i.test(c))}`);
      }
      lines.push('Next: confirm exact fees + scholarships for your compared options.');
      break;

    case 'branch_choice':
      lines.push(
        `Course: ${ev.preferredCourse || 'n/a'}. Goal: ${String(ev.careerGoal || 'n/a').slice(0, 60)}.`
      );
      if (ev.preferredCollege) {
        lines.push(`${ev.preferredCollege} scored well on branch fit.`);
      }
      if (ev.preferredWhy?.[0]) lines.push(`Why it matched: ${ev.preferredWhy[0]}`);
      lines.push('If the branch still matches your goal, the worry is often uncertainty — not a wrong shortlist.');
      break;

    case 'placements':
      lines.push(
        `Career focus: ${ev.careerPriority || 'n/a'}. Placements vary — we avoid package guarantees.`
      );
      if (ev.decisionReasons?.[0]) lines.push(ev.decisionReasons[0]);
      lines.push('Lean on projects, mentoring, and exposure — not brochure numbers alone.');
      break;

    case 'confusion':
      lines.push('Too many open variables. You’ve already done discovery, shortlist, and comparison.');
      if (ev.preferredCollege) {
        lines.push(
          `Clearest lean: ${ev.preferredCollege}${ev.comparedNames.length ? ` among ${ev.comparedNames.join(', ')}` : ''}.`
        );
      }
      lines.push('Pick one variable next — fees, location, or branch.');
      break;

    case 'rank_pressure':
      lines.push('Your shortlist started from eligibility, then fit. Rank anxiety is common.');
      lines.push('Re-check eligibility bands before dropping a good-fit option you’re still eligible for.');
      break;

    case 'peer_pressure':
      lines.push('Friends choosing differently doesn’t cancel your profile.');
      if (ev.evaluationPriorities?.length) {
        lines.push(`You prioritized: ${ev.evaluationPriorities.slice(0, 4).join(', ')}.`);
      }
      lines.push('Use peer input as info — not an override.');
      break;

    case 'family_pressure':
      lines.push(
        `Family notes: ${String(ev.parentPreferences || (ev.familyConstraints || []).join(', ') || 'not detailed').slice(0, 120)}.`
      );
      if (ev.preferredCollege) {
        lines.push(`Share the ${ev.preferredCollege} reasons — course, budget, location.`);
      }
      lines.push('Align where you can; name trade-offs where you can’t.');
      break;

    case 'location':
      lines.push(
        `Location: ${ev.preferredLocation || 'n/a'}; relocation: ${ev.relocationPreference || 'n/a'}.`
      );
      if (ev.preferredCollege) {
        lines.push(`${ev.preferredCollege} already scored location as one factor.`);
      }
      lines.push('Check hostel/travel against the options you compared.');
      break;

    default:
      lines.push(`You raised: “${String(objectionText || '').slice(0, 120)}”.`);
      if (ev.preferredCollege) lines.push(`Current lean: ${ev.preferredCollege}.`);
      if (ev.comparisonSummary) {
        lines.push(`Summary: ${String(ev.comparisonSummary).slice(0, 160)}`);
      }
      lines.push('Which part still feels stuck — fees, branch, location, family, or placements?');
      break;
  }

  lines.push('');
  lines.push('_Decision support from your profile — not admissions advice._');

  return lines.join('\n');
}

/**
 * Decision readiness 0–100 (persisted; may be shown lightly or kept internal).
 */
function calculateDecisionReadiness(profile = {}) {
  let score = 30;
  const active = Array.isArray(profile.activeConcerns) ? profile.activeConcerns : [];
  const resolved = Array.isArray(profile.resolvedConcerns) ? profile.resolvedConcerns : [];

  if (resolved.length > 0) score += Math.min(25, resolved.length * 8);
  if (active.length === 0) score += 20;
  else if (active.length === 1) score += 8;
  else score += Math.max(0, 10 - active.length * 3);

  const counseling = Number(profile.counselingConfidenceScore);
  if (Number.isFinite(counseling)) score += Math.round(counseling * 0.15);

  const decision = Number(profile.decisionConfidence);
  if (Number.isFinite(decision)) score += Math.round(decision * 0.12);

  if (profile.preferredCollege) score += 8;
  if (profile.comparisonSummary) score += 5;
  if (Array.isArray(profile.recommendedColleges) && profile.recommendedColleges.length > 0) score += 4;

  return Math.max(0, Math.min(100, score));
}

function appendObjectionHistory(profile, entry) {
  const hist = Array.isArray(profile.objectionHistory) ? [...profile.objectionHistory] : [];
  hist.push({
    ...entry,
    at: new Date().toISOString(),
  });
  return hist.slice(-30);
}

module.exports = {
  CONCERN_ENGINE_VERSION,
  mapLegacyConcern,
  seedActiveConcerns,
  classifyConcernText,
  generatePersonalizedConcernResponse,
  calculateDecisionReadiness,
  appendObjectionHistory,
  pickEvidence,
};
