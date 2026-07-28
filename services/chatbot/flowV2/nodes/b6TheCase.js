'use strict';

/**
 * Flow v2 — B6 · The Case.
 *
 * Only exports `handleB6Entry(ctx)` — there is no genuine student decision
 * point inside B6 itself (that's B7's job), so no `handleB6Reply` is exported.
 *
 * Sends up to 3 bubbles in one turn, zero gates between them (Master Flow):
 *   1. Comparison factor table (ONLY if compareMode === 'full')
 *   2. Recommendation — "If I had to pick one for you…" + why-bullets
 *   3. Vision bubble — possibility language only
 */

const { runComparison } = require('../../careerCounselling/careerCounsellingV2ComparisonCore');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { mapFlowV2ProfileToMatrixProfile } = require('./b5Shortlist');

const WEAK_CONFIDENCE_LINE =
  'Some profile signals are still thin — treat this as decision support, not certainty.';

const VISION_BUBBLE =
  "Picture your first semester there.\n\n" +
  "Instead of only sitting in lectures, you're shipping small projects, pairing with a mentor, and building a portfolio that internships actually look at.\n\n" +
  "That's the direction you'd be moving in.";

function selectCollegesForComparison(shortlist) {
  return (shortlist || []).filter((c) => c.tier === 'best_match' || c.tier === 'strong_alternative');
}

function mapShortlistItemToComparisonCollege(item) {
  return {
    collegeName: item.collegeName,
    branchName: 'Computer Science / Emerging Tech',
    tier: item.tier,
    fee: null,
    cutoff: null,
  };
}

function shortCollegeLabel(name) {
  const base = String(name || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim();
  const first = base.split(/\s+/)[0] || base;
  return first.slice(0, 10);
}

function comparisonDimensions(profile) {
  const goal = (profile.goalPriority || [])[0];
  if (goal === 'ai_future_tech') return ['AI focus', 'Projects', 'Mentorship', 'Placements'];
  if (goal === 'affordable' || goal === 'fee') return ['Fees fit', 'Projects', 'Mentorship', 'Placements'];
  if (goal === 'higher_studies') return ['Academics', 'Projects', 'Mentorship', 'Placements'];
  if (goal === 'startup' || goal === 'entrepreneurship') {
    return ['Projects', 'Mentorship', 'AI focus', 'Placements'];
  }
  return ['Placements', 'AI focus', 'Projects', 'Mentorship'];
}

function dotsFor(college, dimension, primaryGoal) {
  const tier = college.tier;
  const dim = String(dimension || '').toLowerCase();
  const goalBoost =
    (primaryGoal === 'ai_future_tech' && dim.includes('ai')) ||
    (primaryGoal === 'placement' && dim.includes('placement')) ||
    ((primaryGoal === 'startup' || primaryGoal === 'entrepreneurship') && dim.includes('project'));
  if (tier === 'best_match') return '●●●';
  if (tier === 'strong_alternative') return goalBoost ? '●●●' : '●●';
  return '●●';
}

/** Master Flow B6.1 — factor table, max 4 rows / top 3 colleges. */
function buildComparisonBody(profile, compared) {
  const colleges = compared.slice(0, 3);
  const dims = comparisonDimensions(profile).slice(0, 4);
  const labels = colleges.map((c) => shortCollegeLabel(c.collegeName));
  const colWidth = Math.max(8, ...labels.map((l) => l.length));
  const factorWidth = Math.max(8, ...dims.map((d) => d.length));
  const pad = (s, w) => String(s).padEnd(w, ' ');
  const header = `${pad('Factor', factorWidth)}  ${labels.map((l) => pad(l, colWidth)).join('  ')}`;
  const lines = [
    "Here's how your top 3 stack up on what you care about 👇",
    '',
    header,
  ];
  const primaryGoal = (profile.goalPriority || [])[0];
  for (const dim of dims) {
    const cells = colleges.map((c) => pad(dotsFor(c, dim, primaryGoal), colWidth));
    lines.push(`${pad(dim, factorWidth)}  ${cells.join('  ')}`);
  }
  return lines.join('\n');
}

function buildComparisonMessage(profile) {
  const compared = selectCollegesForComparison(profile.shortlist);
  if (compared.length < 2) return { text: null, comparedNames: [] };
  // Keep matrix comparison for analytics/side effects; table copy is MD-shaped.
  try {
    const matrixProfile = mapFlowV2ProfileToMatrixProfile(profile);
    runComparison(matrixProfile, compared.map(mapShortlistItemToComparisonCollege));
  } catch {
    // Non-fatal — table does not depend on engine cards.
  }
  return {
    text: buildComparisonBody(profile, compared),
    comparedNames: compared.map((c) => c.collegeName),
  };
}

const GOAL_WHY_BULLET = Object.freeze({
  placement: 'You said placements come first — its structure is built around that.',
  ai_future_tech: "You're drawn to AI, and the curriculum is AI-first rather than AI-as-an-elective.",
  affordable: 'It also fits more comfortably within the tighter budget you mentioned.',
  fee: 'It also fits more comfortably within the tighter budget you mentioned.',
  higher_studies: "You're thinking longer-term, and this gives you a strong academic base for what comes after.",
  startup: "You'd be building from early on, which is what actually converts into real opportunities.",
  entrepreneurship: "You'd be building from early on, which is what actually converts into real opportunities.",
});

const BUDGET_WHY_BULLET = Object.freeze({
  under_2l: 'It also fits comfortably within the tighter budget you mentioned.',
  '2_5l': 'It fits within the budget range you shared.',
  '5l_plus': "Budget isn't the limiting filter here, based on what you shared.",
  '2_4l': 'It fits within the budget range you shared.',
  '4_6l': 'It fits within the budget range you shared.',
  '6_10l': 'It fits within the budget range you shared.',
  above_10l: "Budget isn't the limiting filter here, based on what you shared.",
});

function buildWhyBullets(bestFitItem, profile) {
  const bullets = [];
  const primaryGoal = (profile.goalPriority || [])[0];
  if (GOAL_WHY_BULLET[primaryGoal]) bullets.push(GOAL_WHY_BULLET[primaryGoal]);
  if (bestFitItem.why) bullets.push(bestFitItem.why);
  const budgetBullet = BUDGET_WHY_BULLET[profile.budgetBand];
  if (budgetBullet && !bullets.includes(budgetBullet)) bullets.push(budgetBullet);
  if (!bullets.length) {
    bullets.push("Here's why it fits you specifically based on what you shared.");
  }
  return bullets.slice(0, 3);
}

function buildRecommendationText(bestFitItem, profile) {
  const bullets = buildWhyBullets(bestFitItem, profile);
  const name = profile.name ? String(profile.name).trim().split(/\s+/)[0] : null;
  const pickLine = name
    ? `If I had to pick one for you, ${name} — *${bestFitItem.collegeName}*.`
    : `If I had to pick one for you — *${bestFitItem.collegeName}*.`;
  const lines = [
    pickLine,
    '',
    "Here's why it fits you specifically:",
    ...bullets.map((b) => `\u2022 ${b}`),
    '',
    'The others stay strong backups if you want a different pace.',
    '',
    WEAK_CONFIDENCE_LINE,
  ];
  return lines.join('\n');
}

function buildVisionBubble() {
  return VISION_BUBBLE;
}

const NO_SHORTLIST_FALLBACK_TEXT =
  "I don't have a shortlist to build a case from yet \u2014 let's go back and get that sorted first.";

/**
 * @param {{ flowV2?: { compareMode?: 'full'|'best_only', profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB6Entry(ctx) {
  // V3: B9 FIT replaces compare/vision "the case".
  return require('./b9Fit').handleB9Entry(ctx);
}

module.exports = {
  handleB6Entry,
  selectCollegesForComparison,
  buildComparisonMessage,
  buildWhyBullets,
  buildRecommendationText,
  buildVisionBubble,
  WEAK_CONFIDENCE_LINE,
  VISION_BUBBLE,
};
