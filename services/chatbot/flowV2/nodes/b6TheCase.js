'use strict';

/**
 * Flow v2 — B6 · The Case.
 *
 * Only exports `handleB6Entry(ctx)` — there is no genuine student decision
 * point inside B6 itself this phase (that's B7's job, Phase 7, not built
 * yet), so following the same "don't build a handler for a beat with no
 * question" discipline already established for B4, no `handleB6Reply` is
 * exported.
 *
 * Sends up to 3 bubbles in one turn, zero gates between them:
 *   1. Comparison table (ONLY if `context.flowV2.compareMode === 'full'`,
 *      set by B5's `[ Compare them ]` button — skipped entirely for
 *      `'best_only'`)
 *   2. Recommendation message — names the best-fit college + 2-3
 *      Flow-v2-owned why-bullets, run through the THROWING guardrail
 *      variant before being allowed to send
 *   3. Vision bubble — one present-tense, personalized paragraph
 *
 * No hesitation prompt anywhere in this file, by design (explicitly cut
 * from the original spec) — do not add one even with good intentions.
 */

const { runComparison } = require('../../careerCounselling/careerCounsellingV2ComparisonCore');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { mapFlowV2ProfileToMatrixProfile } = require('./b5Shortlist');

// ---------------------------------------------------------------------------
// Comparison (reused, real — careerCounsellingV2ComparisonCore.js, exported
// and pure, no local reimplementation needed here).
// ---------------------------------------------------------------------------

/** Compares the top of the shortlist (best match + strong alternatives),
 * not the full 7-college list — `analyzeTradeoffs()` is designed to
 * contrast a small set, and a genuine "compare them" ask is naturally
 * about the strongest contenders, not the long tail already labeled
 * "Worth Exploring". */
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

function buildComparisonBody(comparisonResult) {
  const lines = ['*How they compare*', ''];
  for (const card of comparisonResult.cards) {
    const topLine = card.whyFits[0] || card.strengths[0] || 'A solid option on your shortlist.';
    lines.push(`*${card.collegeName}* \u2014 ${topLine}`);
  }
  if (comparisonResult.tradeoffs.length) {
    lines.push('');
    for (const t of comparisonResult.tradeoffs) lines.push(`\u2022 ${t}`);
  }
  return lines.join('\n');
}

function buildComparisonMessage(profile) {
  const compared = selectCollegesForComparison(profile.shortlist);
  if (compared.length < 2) return { text: null, comparedNames: [] };
  const matrixProfile = mapFlowV2ProfileToMatrixProfile(profile);
  const comparisonColleges = compared.map(mapShortlistItemToComparisonCollege);
  const result = runComparison(matrixProfile, comparisonColleges);
  return { text: buildComparisonBody(result), comparedNames: compared.map((c) => c.collegeName) };
}

// ---------------------------------------------------------------------------
// Recommendation message — fresh, Flow-v2-owned why-bullet logic.
//
// CORRECTION (Phase 6): the original plan assumed old V2's Phase 9
// why-bullet builder (`buildCounselorWhyBullets`) could be reused. Direct
// verification (`require()` + inspecting module.exports) found it is NOT
// exported from careerCounsellingV2PersonalizedRecommendationCore.js —
// same "private helper" situation as the matrix's catalog/boost helpers in
// b5Shortlist.js. Unlike those, this is NOT ported/duplicated — B6's
// why-bullets need to be tied to Flow-v2-native fields (goalPriority/
// branchInterest/budgetBand) that don't cleanly exist in old V2's own
// vocabulary anyway, so this is legitimately new, Flow-v2-owned copy logic
// rather than a duplicate of the old private function.
// ---------------------------------------------------------------------------

const GOAL_WHY_BULLET = Object.freeze({
  placement: 'This is one of the stronger placement-focused picks on your shortlist.',
  ai_future_tech: 'This leans hardest into the AI and future-tech direction you told me mattered most.',
  affordable: 'This is one of the more budget-friendly picks that still holds up on quality.',
  fee: 'This is one of the more budget-friendly picks that still holds up on quality.',
  higher_studies: 'This gives you a strong academic base if you go on to higher studies.',
  startup: 'This has the kind of hands-on, founder-adjacent exposure that suits a startup path.',
  entrepreneurship: 'This has the kind of hands-on, founder-adjacent exposure that suits a startup path.',
});

const BUDGET_WHY_BULLET = Object.freeze({
  under_2l: 'It also fits comfortably within the tighter budget you mentioned.',
  '2_5l': 'It fits within the budget range you shared.',
  '5l_plus': "Budget isn't a constraint here, based on what you shared.",
  '2_4l': 'It fits within the budget range you shared.',
  '4_6l': 'It fits within the budget range you shared.',
  '6_10l': 'It fits within the budget range you shared.',
  above_10l: "Budget isn't a constraint here, based on what you shared.",
});

/**
 * 2-3 bullets: a goalPriority-tied line, the catalog's own why-blurb for
 * this college (already branch-relevant, since the student picked this
 * branch/college via the shortlist), and a budget-tied line where
 * available. Exported for direct testability (not for mocking — see the
 * guardrail test's own approach in the test file, which injects forbidden
 * content through `profile.shortlist` data instead of mocking this
 * function, so the guardrail check is exercised against a genuinely
 * assembled string, not a stubbed one).
 */
function buildWhyBullets(bestFitItem, profile) {
  const bullets = [];
  const primaryGoal = (profile.goalPriority || [])[0];
  if (GOAL_WHY_BULLET[primaryGoal]) bullets.push(GOAL_WHY_BULLET[primaryGoal]);
  if (bestFitItem.why) bullets.push(bestFitItem.why);
  const budgetBullet = BUDGET_WHY_BULLET[profile.budgetBand];
  if (budgetBullet) bullets.push(budgetBullet);
  if (!bullets.length) {
    bullets.push('This is the strongest overall match on your shortlist for what you told me matters.');
  }
  return bullets.slice(0, 3);
}

function buildRecommendationText(bestFitItem, profile) {
  const bullets = buildWhyBullets(bestFitItem, profile);
  const lines = [`*${bestFitItem.collegeName}* looks like the strongest fit for you.`, '', ...bullets.map((b) => `\u2022 ${b}`)];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Vision bubble — new, present-tense, personalized. No curriculum claims
// beyond what the catalog's own `why` field already states.
// ---------------------------------------------------------------------------

const GOAL_VISION_CLAUSE = Object.freeze({
  placement: "and every project you touch is being built with placement day in mind",
  ai_future_tech: "and it's the AI-and-tech work you said mattered most, not a side elective",
  affordable: "and you're getting there without the financial strain you were worried about",
  fee: "and you're getting there without the financial strain you were worried about",
  higher_studies: "and you're already building the base you'll stand on for whatever comes after",
  startup: "and the people around you are building things, not just studying for exams",
  entrepreneurship: "and the people around you are building things, not just studying for exams",
});

function buildVisionBubble(bestFitItem, profile) {
  const primaryGoal = (profile.goalPriority || [])[0];
  const clause = GOAL_VISION_CLAUSE[primaryGoal];
  const base = `Picture your first semester at ${bestFitItem.collegeName} \u2014 you're already building a real project instead of just prepping for exams`;
  return clause ? `${base}, ${clause}. That's the shift most students notice first.` : `${base}. That's the shift most students notice first.`;
}

// ---------------------------------------------------------------------------
// Node entry.
// ---------------------------------------------------------------------------

const NO_SHORTLIST_FALLBACK_TEXT =
  "I don't have a shortlist to build a case from yet \u2014 let's go back and get that sorted first.";

/**
 * @param {{ flowV2?: { compareMode?: 'full'|'best_only', profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB6Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const compareMode = ctx?.flowV2?.compareMode || null;
  const shortlist = Array.isArray(profile.shortlist) ? profile.shortlist : [];
  const bestFit = shortlist.find((c) => c.tier === 'best_match');

  if (!bestFit) {
    // Defensive: B6 reached without B5 ever populating a shortlist. Not
    // expected on the normal B5 -> B6 path, but must not crash.
    return {
      replyText: NO_SHORTLIST_FALLBACK_TEXT,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'b5_awaiting_entry', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const replyParts = [];
  let nextProfile = profile;

  if (compareMode === 'full') {
    const { text, comparedNames } = buildComparisonMessage(profile);
    if (text) {
      replyParts.push(text);
      // Direct overwrite, not mergeFlowV2Profile — comparedColleges is a
      // fresh "this turn's output" value, not an accumulating log, and B6
      // never re-runs itself the way B5's "Change something" loop does.
      nextProfile = { ...nextProfile, comparedColleges: comparedNames };
    }
  }

  // GUARDRAIL: run the fully-assembled recommendation text through the
  // THROWING guardrail variant (not the soft collectGuardrailViolations())
  // before it is allowed into replyParts — a violation here must hard-fail
  // the turn, per this beat's spec, not silently log and send anyway.
  const recommendationText = assertGuardrails(buildRecommendationText(bestFit, profile));
  replyParts.push(recommendationText);
  replyParts.push(buildVisionBubble(bestFit, profile));

  nextProfile = { ...nextProfile, recommendation: bestFit.collegeName };

  return {
    replyText: null,
    replyParts,
    interactive: null,
    // B7 doesn't exist yet (Phase 7) — falls through to safeFallbackReply,
    // same established precedent as 'b3_awaiting_entry'/'b5_awaiting_entry'
    // before their beats existed.
    contextPatch: { stage: 'b7_awaiting_entry', profile: nextProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB6Entry,
  // exported for focused unit testing
  selectCollegesForComparison,
  buildComparisonMessage,
  buildWhyBullets,
  buildRecommendationText,
  buildVisionBubble,
};
