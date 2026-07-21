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
      _curatedId: c._curatedId || null,
      _curatedTags: Array.isArray(c._curatedTags) ? c._curatedTags : [],
      _curatedWhy: c._curatedWhy || null,
      shortlistMatchLine: (() => {
        const narrative = Array.isArray(profile.shortlistNarrative)
          ? profile.shortlistNarrative.find(
              (n) => collegeKey(n.collegeName || n) === name
            )
          : null;
        return narrative?.matchLine || null;
      })(),
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

function profileSignalsBlob(profile = {}) {
  return [
    profile.careerGoal,
    profile.careerPriority,
    profile.preferredCourse,
    profile.preferredLearningStyle,
    ...(Array.isArray(profile.studentPriorities) ? profile.studentPriorities : []),
    ...(Array.isArray(profile.evaluationPriorities) ? profile.evaluationPriorities : []),
    ...(Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function niatProfileFit(profile = {}) {
  const blob = profileSignalsBlob(profile);
  const lean = String(profile.preferredCollege || '').toLowerCase();
  const signalHit =
    /\bai\b|artificial intelligence|machine learning|projects?|mentor|industry|internship|portfolio/.test(blob);
  const leanHit = /\bniat\b/.test(lean);
  return signalHit || leanHit;
}

function selectBestFitCollege(profile = {}) {
  const items = selectRankedRecommendations(profile);
  if (!items.length) return null;
  const lean = String(profile.preferredCollege || '').toLowerCase();
  const niatItem = items.find((i) => /\bniat\b/i.test(i.collegeName || ''));
  if (niatItem && niatProfileFit(profile)) {
    if (!lean || /\bniat\b/.test(lean)) return niatItem;
    const reasons = Array.isArray(profile.decisionReasons) ? profile.decisionReasons.join(' ').toLowerCase() : '';
    if (/\bai\b|project|mentor|industry|portfolio/.test(reasons)) return niatItem;
  }
  if (lean) {
    const leaned = items.find((i) => String(i.collegeName || '').toLowerCase() === lean);
    if (leaned) return leaned;
  }
  return items[0];
}

function resolveBestFitCatalogSignals(bestFit = {}) {
  let tags = Array.isArray(bestFit._curatedTags) ? bestFit._curatedTags : [];
  let why = bestFit._curatedWhy || '';
  if (tags.length || why) return { tags, why };

  try {
    const {
      CURATED_MODERN_CATALOG,
    } = require('../../../constants/careerCounsellingV2ExploreModernColleges');
    const name = String(bestFit.collegeName || '').toLowerCase();
    const hit = CURATED_MODERN_CATALOG.find(
      (item) =>
        String(item.name || '').toLowerCase() === name ||
        name.includes(String(item.id || '').toLowerCase()) ||
        /\bniat\b/i.test(name)
    );
    if (hit) {
      tags = Array.isArray(hit.tags) ? hit.tags : [];
      why = hit.why || '';
    }
  } catch (_err) {
    // Catalog optional for eligibility-only shortlists.
  }
  return { tags, why };
}

function buildCounselorWhyBullets(bestFit, profile = {}) {
  const { tags, why } = resolveBestFitCatalogSignals(bestFit);
  const has = (t) => tags.includes(t);
  const isNiat = /\bniat\b/i.test(bestFit.collegeName || '');
  const bullets = [];

  if (isNiat && niatProfileFit(profile)) {
    if (has('ai') || why) {
      bullets.push(
        'Its AI-focused curriculum aligns with the direction you’ve been exploring.'
      );
    }
    if (has('projects') || has('industry')) {
      bullets.push(
        'Industry-integrated projects can help you build practical experience alongside academics.'
      );
    }
    if (has('mentoring')) {
      bullets.push(
        'Mentorship support can help you stay guided as you shape skills for real-world roles.'
      );
    }
    if (has('internships') || has('hands_on')) {
      bullets.push(
        'Hands-on learning and internship readiness can strengthen your portfolio over time.'
      );
    }
    if (why && bullets.length < 4) {
      bullets.push(`${why.replace(/\.$/, '')}.`);
    }
  } else {
    if (why) bullets.push(`${String(why).replace(/\.$/, '')}.`);
    if (bestFit.shortlistMatchLine) bullets.push(bestFit.shortlistMatchLine);
    const reasonWhy = Array.isArray(bestFit.reasons?.why)
      ? bestFit.reasons.why.filter(Boolean)
      : [];
    for (const w of reasonWhy) {
      if (bullets.length >= 5) break;
      const cleaned = String(w).replace(/\.$/, '');
      if (!bullets.some((b) => b.toLowerCase().includes(cleaned.toLowerCase().slice(0, 40)))) {
        bullets.push(`${cleaned}.`);
      }
    }
    if (has('projects') || has('hands_on')) {
      bullets.push('Project-oriented learning can help you build a stronger applied portfolio.');
    }
    if (has('mentoring')) {
      bullets.push('Mentorship pathways can support clearer skill and career decisions.');
    }
    if (has('internships') || has('placements')) {
      bullets.push('Career-preparation signals on this path align with practical readiness goals.');
    }
    if (has('ai') || has('innovation')) {
      bullets.push('The learning approach leans toward modern, future-ready skill building.');
    }
  }

  return uniq(bullets).slice(0, 5);
}

function buildGoalConnectionLine(profile = {}, collegeName) {
  const goal = profile.careerGoal || profile.careerPriority || null;
  const course = profile.preferredCourse || null;
  if (goal && course) {
    return `For someone focused on ${String(course).slice(0, 50)} with goals around ${String(goal).slice(0, 60)}, ${collegeName} can be a strong next step to explore.`;
  }
  if (goal) {
    return `Given your focus on ${String(goal).slice(0, 70)}, ${collegeName} appears well aligned with the path you’ve been shaping.`;
  }
  if (course) {
    return `Given your interest in ${String(course).slice(0, 50)}, ${collegeName} appears well aligned with what you’ve shared so far.`;
  }
  return `Based on everything you’ve shared, ${collegeName} appears well aligned with the direction you’ve been shaping.`;
}

function formatBestFitRecommendation(profile, bestFit, items = []) {
  const lines = [];

  if (!bestFit) {
    return getPhase9Message('empty');
  }

  const college = bestFit.collegeName;
  lines.push(
    getPhase9Message('header').replace('{{college}}', college)
  );
  lines.push('');
  lines.push(
    getPhase9Message('recommendation_prefix').replace('{{college}}', college)
  );
  const bullets = buildCounselorWhyBullets(bestFit, profile);
  const fallbackReasons = bullets.length
    ? bullets
    : buildReasoningLines(bestFit, profile).slice(0, 4);
  for (const reason of fallbackReasons.slice(0, 5)) {
    lines.push(`• ${reason}`);
  }
  lines.push('');
  lines.push(buildGoalConnectionLine(profile, college));
  lines.push('');
  if (isWeakConfidence(profile, items)) {
    lines.push(getPhase9Message('weak_confidence_note'));
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
  const bestFit = selectBestFitCollege(profile);
  const overallLabel = overallConfidenceLabel(profile, items);
  const comparisonInsight = buildComparisonInsight(profile, items);
  const reply = formatBestFitRecommendation(profile, bestFit, items);
  const tradeoffs = buildTradeoffs(items);

  return {
    items,
    bestFit,
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
  formatBestFitRecommendation,
  selectBestFitCollege,
  synthesizePersonalizedRecommendation,
};
