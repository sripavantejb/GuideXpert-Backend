'use strict';

const {
  RANK_LABELS,
  CONFIDENCE_LABELS,
  getPhase9Message,
} = require('../../../constants/careerCounsellingV2PersonalizedRecommendation');

/** Phase 5 tier → Phase 9 display label (no re-ranking). */
const TIER_TO_DISPLAY = Object.freeze({
  best_match: { rankKey: 'best', rankLabel: RANK_LABELS.best },
  strong_alternative: { rankKey: 'strong', rankLabel: RANK_LABELS.strong },
  worth_exploring: { rankKey: 'backup', rankLabel: RANK_LABELS.backup },
});

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function collegeKey(item) {
  return String(item?.collegeName || item || '').trim();
}

/**
 * Map Phase 5 tier → human confidence label only (never re-scores).
 */
function labelForConfidence(numericHint, tier) {
  const n = Number(numericHint);
  if (tier === 'best_match' || (Number.isFinite(n) && n >= 75)) {
    return CONFIDENCE_LABELS.excellent;
  }
  if (tier === 'strong_alternative' || (Number.isFinite(n) && n >= 55)) {
    return CONFIDENCE_LABELS.strong;
  }
  return CONFIDENCE_LABELS.good;
}

function overallConfidenceLabel(profile, items) {
  const hints = [
    Number(profile.recommendationConfidence),
    Number(profile.counselingConfidenceScore),
    Number(profile.decisionConfidence),
    Number(profile.decisionReadiness),
  ].filter((n) => Number.isFinite(n));
  const avg = hints.length ? hints.reduce((a, b) => a + b, 0) / hints.length : null;
  const topTier = items.map((i) => i.tier);
  if (topTier.includes('best_match') && (avg == null || avg >= 65)) {
    return CONFIDENCE_LABELS.excellent;
  }
  if (avg != null && avg >= 55) return CONFIDENCE_LABELS.strong;
  if (avg != null && avg < 45) return CONFIDENCE_LABELS.good;
  if (topTier.includes('strong_alternative')) return CONFIDENCE_LABELS.strong;
  return CONFIDENCE_LABELS.good;
}

function isWeakConfidence(profile, items) {
  const label = overallConfidenceLabel(profile, items);
  const rec = Number(profile.recommendationConfidence);
  const missing =
    !profile.preferredCourse ||
    !Array.isArray(profile.recommendedColleges) ||
    profile.recommendedColleges.length === 0;
  return missing || label === CONFIDENCE_LABELS.good || (Number.isFinite(rec) && rec < 45);
}

/**
 * Synthesis-only selection: preserve Phase 5 `recommendedColleges` order.
 * Never re-sorts, never injects preferredCollege, never invents colleges.
 */
function selectRankedRecommendations(profile = {}) {
  const recommended = Array.isArray(profile.recommendedColleges)
    ? profile.recommendedColleges
    : [];
  const reasonsMap = profile.recommendationReasons || {};

  const seen = new Set();
  const ordered = [];
  for (const c of recommended) {
    const name = collegeKey(c);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const tier = c.tier || 'worth_exploring';
    const display = TIER_TO_DISPLAY[tier] || TIER_TO_DISPLAY.worth_exploring;
    ordered.push({
      collegeName: name,
      branchName: c.branchName || null,
      branchCode: c.branchCode || null,
      tier,
      fee: c.fee ?? null,
      cutoff: c.cutoff ?? null,
      reasons: reasonsMap[name] || { why: [], strengths: [], consider: [] },
      rankKey: display.rankKey,
      rankLabel: display.rankLabel,
      confidenceLabel: labelForConfidence(profile.recommendationConfidence, tier),
    });
  }

  return ordered.slice(0, 3);
}

/**
 * Informational only — never changes ranking or tiers.
 */
function buildComparisonInsight(profile = {}, items = []) {
  const preferred = collegeKey(profile.preferredCollege);
  if (!preferred) return null;

  const shortlistNames = new Set(
    (Array.isArray(profile.recommendedColleges) ? profile.recommendedColleges : [])
      .map((c) => collegeKey(c))
      .filter(Boolean)
  );
  const inDisplayed = items.some((i) => i.collegeName === preferred);
  const inShortlist = shortlistNames.has(preferred);
  const reason = Array.isArray(profile.decisionReasons)
    ? profile.decisionReasons.find(Boolean)
    : null;
  const reasonBit = reason ? ` because ${String(reason).replace(/\.$/, '')}` : '';

  if (inShortlist || inDisplayed) {
    return `Comparison Insight: During comparison, you leaned toward ${preferred}${reasonBit}.`;
  }

  // Outside shortlist — historical context only, not a recommendation
  return `Comparison Insight: Earlier comparison mentioned ${preferred} — noted as context only (not part of this shortlist ranking).`;
}

function buildReasoningLines(item, profile) {
  const lines = [];
  const why = Array.isArray(item.reasons?.why) ? item.reasons.why.filter(Boolean) : [];
  const consider = Array.isArray(item.reasons?.consider)
    ? item.reasons.consider.filter(Boolean)
    : [];

  if (profile.preferredCourse) {
    lines.push(`Course focus: ${profile.preferredCourse}.`);
  }
  if (profile.careerGoal || profile.careerPriority) {
    lines.push(
      `Career direction: ${String(profile.careerGoal || profile.careerPriority).slice(0, 80)}.`
    );
  }
  for (const w of why.slice(0, 2)) {
    lines.push(w);
  }
  if (profile.budgetPreference && /fee|budget|afford/i.test(JSON.stringify(why) + JSON.stringify(consider))) {
    lines.push(`Budget context: ${profile.budgetPreference}.`);
  } else if (profile.budgetPreference && item.fee != null) {
    lines.push(`Fee signal on shortlist: ${item.fee} (your budget: ${profile.budgetPreference}).`);
  }
  if (profile.preferredLocation) {
    lines.push(`Location preference: ${profile.preferredLocation}.`);
  }
  if (profile.parentPreferences) {
    lines.push(`Family notes considered: ${String(profile.parentPreferences).slice(0, 80)}.`);
  }
  if (consider[0]) {
    lines.push(`Watch-out: ${consider[0]}`);
  }

  return uniq(lines).slice(0, 4);
}

function buildTradeoffs(items) {
  if (items.length < 2) return [];
  const lines = [];
  for (const item of items) {
    const bits = [];
    if (item.reasons?.why?.[0]) bits.push(item.reasons.why[0]);
    else if (item.branchName) bits.push(`${item.branchName} path`);
    if (item.fee != null) bits.push(`fee signal ${item.fee}`);
    if (item.reasons?.consider?.[0]) bits.push(`trade-off: ${item.reasons.consider[0]}`);
    lines.push(
      `• ${item.collegeName} — ${bits.slice(0, 2).join('; ') || item.rankLabel}`
    );
  }
  return lines.slice(0, 3);
}

function formatRecommendationReply(profile, items) {
  const lines = [];

  if (items.length === 0) {
    return getPhase9Message('empty');
  }

  lines.push(getPhase9Message('header'));
  lines.push('');

  const profileBits = [];
  if (profile.preferredCourse) profileBits.push(profile.preferredCourse);
  if (profile.careerPriority || profile.careerGoal) {
    profileBits.push(String(profile.careerPriority || profile.careerGoal).slice(0, 40));
  }
  if (profile.budgetPreference) profileBits.push(`budget: ${profile.budgetPreference}`);
  if (profileBits.length) {
    lines.push(`For you (${profileBits.join(' · ')}):`);
    lines.push('');
  }

  for (const item of items) {
    const title = item.branchName
      ? `*${item.rankLabel}: ${item.collegeName} — ${item.branchName}*`
      : `*${item.rankLabel}: ${item.collegeName}*`;
    lines.push(title);
    lines.push(`Fit: ${item.confidenceLabel}`);
    for (const reason of buildReasoningLines(item, profile)) {
      lines.push(`✅ ${reason}`);
    }
    lines.push('');
  }

  const insight = buildComparisonInsight(profile, items);
  if (insight) {
    lines.push(insight);
    lines.push('');
  }

  const tradeoffs = buildTradeoffs(items);
  if (tradeoffs.length) {
    lines.push(getPhase9Message('tradeoffs_header'));
    lines.push(...tradeoffs);
    lines.push('');
  }

  if (isWeakConfidence(profile, items)) {
    lines.push(getPhase9Message('weak_confidence_note'));
    lines.push('');
  }

  const resolved = Array.isArray(profile.resolvedConcerns) ? profile.resolvedConcerns : [];
  if (resolved.length) {
    lines.push(`Concerns we already worked through: ${resolved.slice(0, 3).join(', ')}.`);
    lines.push('');
  }

  lines.push(getPhase9Message('soft_transition'));
  lines.push('');
  lines.push(getPhase9Message('ask_continue'));

  return lines.join('\n').trim();
}

/**
 * Full synthesis package for persistence + rendering.
 * Never mutates Phase 5 ranking or invents colleges.
 */
function synthesizePersonalizedRecommendation(profile = {}) {
  const items = selectRankedRecommendations(profile);
  const overallLabel = overallConfidenceLabel(profile, items);
  const comparisonInsight = buildComparisonInsight(profile, items);
  const reply = formatRecommendationReply(profile, items);
  const tradeoffs = buildTradeoffs(items);

  return {
    items,
    overallConfidenceLabel: overallLabel,
    weakConfidence: isWeakConfidence(profile, items),
    comparisonInsight,
    tradeoffs,
    reply,
    summary: items.map((i) => `${i.rankLabel}: ${i.collegeName}`).join('; '),
  };
}

module.exports = {
  TIER_TO_DISPLAY,
  selectRankedRecommendations,
  buildComparisonInsight,
  buildReasoningLines,
  buildTradeoffs,
  labelForConfidence,
  overallConfidenceLabel,
  isWeakConfidence,
  formatRecommendationReply,
  synthesizePersonalizedRecommendation,
};
