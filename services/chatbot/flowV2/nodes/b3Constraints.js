'use strict';

/**
 * Flow v2 — B3 · Constraints (budget + location).
 *
 * Unlike B1/B2, B3 gates on TWO independent slots (`budgetBand`,
 * `cityPref`) rather than one, so `handleB3Entry` has four distinct
 * outcomes instead of a simple skip/ask binary:
 *   a) both already filled          -> skip straight to B4
 *   b) budgetBand filled, city not  -> ask ONLY the location question
 *   c) cityPref filled, budget not  -> ask ONLY the budget question
 *   d) neither filled               -> ask budget first (standard order)
 *
 * Cases (c) and (d) start identically (both ask the budget question from
 * the same `'b3_awaiting_budget'` stage) — the only difference between
 * them is invisible at ask-time and only matters once the budget reply
 * comes back: `handleB3Reply`'s budget branch re-checks `cityPref` after
 * merging, and if it's already filled (case c's pre-fill, OR an
 * over-answering budget reply that also named a city), skips the location
 * question entirely and advances straight to B4. This is the SAME check
 * either way, so case (c) doesn't need its own separate code path.
 *
 * Two distinct awaiting-reply stages (`b3_awaiting_budget` /
 * `b3_awaiting_location`), not one generic one, because `handleB3Reply`
 * needs to know which question is actually pending.
 *
 * "Last one \u2014" only ever prefixes the location question when it is
 * asked immediately after budget was JUST answered in this same beat
 * (the normal sequential d-then-b3Reply path) \u2014 never in case (b)'s
 * entry-time "location is the ONLY question this student gets" ask.
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile } = require('../flowV2NodeUtils');
const { handleB4Entry } = require('./b4Bridge');

const BUDGET_QUESTION = "What's comfortable for your family, per year?\nWhy I ask: it keeps the options practical.";
const BUDGET_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b3_budget_under_2l', title: 'Under \u20B92L' }),
  Object.freeze({ id: 'flowv2_b3_budget_2_5l', title: '\u20B92\u20135L' }),
  Object.freeze({ id: 'flowv2_b3_budget_5l_plus', title: '\u20B95L+' }),
]);

const LOCATION_QUESTION_ONLY = 'Near home, or open to moving?\nWhy I ask: location changes what\u2019s realistic.';
const LOCATION_QUESTION_SEQUENTIAL =
  'Last one \u2014 near home, or open to moving?\nWhy I ask: location changes what\u2019s realistic.';
const LOCATION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b3_location_near_home', title: 'Near home' }),
  Object.freeze({ id: 'flowv2_b3_location_open_to_move', title: 'Open to move' }),
  Object.freeze({ id: 'flowv2_b3_location_metro', title: 'Metro cities' }),
]);

function isFilled(value) {
  return typeof value === 'string' && value.length > 0;
}

function askBudget(profile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: { type: 'button', body: BUDGET_QUESTION, buttons: BUDGET_BUTTONS },
    contextPatch: { stage: 'b3_awaiting_budget', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function askLocation(profile, { sequential }) {
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: sequential ? LOCATION_QUESTION_SEQUENTIAL : LOCATION_QUESTION_ONLY,
      buttons: LOCATION_BUTTONS,
    },
    contextPatch: { stage: 'b3_awaiting_location', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB3Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const budgetFilled = isFilled(profile.budgetBand);
  const cityFilled = isFilled(profile.cityPref);

  if (budgetFilled && cityFilled) {
    return handleB4Entry(ctx);
  }
  if (budgetFilled && !cityFilled) {
    return askLocation(profile, { sequential: false });
  }
  // Covers both "cityPref filled, budgetBand not" (c) and "neither
  // filled" (d) \u2014 both ask budget first from the same stage; the
  // eventual difference (whether location gets asked afterward) is
  // resolved by handleB3BudgetReply's own cityPref re-check below.
  return askBudget(profile);
}

/**
 * Recognizes B3's own three budget buttons directly, rather than routing
 * through the generic free-text `extractBudgetBand` (a genuinely
 * different input shape \u2014 a specific rupee/lakh figure in prose, not
 * a coarse 3-way choice). This is a deliberate, documented judgment call:
 * feeding these exact button titles through the generic extractor gives
 * WRONG results for two of the three ("\u20B92\u20135L" and "\u20B95L+"
 * both collapse to its existing '4_6l' band, silently losing the
 * "up to 5" vs "open-ended 5-plus" distinction) \u2014 see this phase's
 * output notes for the empirical trace. `under_2l` intentionally reuses
 * the SAME canonical value the generic extractor already produces for an
 * unambiguous "under 2 lakhs" free-text statement; `2_5l` / `5l_plus` are
 * two new canonical values scoped to this coarser 3-button UI (the
 * existing 5-tier free-text bands remain untouched and still available
 * for genuine free-text over-answers, e.g. an R3/R4 message that states
 * an exact figure instead of tapping a button).
 */
const BUDGET_TAP_PATTERNS = Object.freeze([
  Object.freeze({ re: /\bunder\b.*\b2\s*l\b/i, band: 'under_2l' }),
  Object.freeze({ re: /\b5\s*l\s*\+/i, band: '5l_plus' }),
  Object.freeze({ re: /\b2\s*[\u2013\u2014-]\s*5\s*l\b/i, band: '2_5l' }),
]);
function extractB3BudgetTap(text) {
  const t = String(text || '');
  for (const { re, band } of BUDGET_TAP_PATTERNS) {
    if (re.test(t)) return band;
  }
  return null;
}

/**
 * Same rationale as the budget taps above: "Near home" / "Open to move" /
 * "Metro cities" are relocation STANCES, not city names, so the generic
 * `extractCityPref` (a curated city-name list) never matches them \u2014
 * confirmed empirically, not assumed. `cityPref`'s own schema description
 * already anticipates this ("Preferred city/location OR relocation
 * stance"), so these three stance values share the slot with actual city
 * names from free text without any schema change.
 */
const LOCATION_TAP_PATTERNS = Object.freeze([
  Object.freeze({ re: /\bnear home\b/i, value: 'near_home' }),
  Object.freeze({ re: /\bopen to (mov(e|ing)|relocat(e|ing))\b/i, value: 'open_to_move' }),
  Object.freeze({ re: /\bmetro cit(y|ies)\b/i, value: 'metro' }),
]);
function extractB3LocationTap(text) {
  const t = String(text || '');
  for (const { re, value } of LOCATION_TAP_PATTERNS) {
    if (re.test(t)) return value;
  }
  return null;
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB3BudgetReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const freeTextPatch = extractFlowV2Slots(text, profile);
  const budgetBand = extractB3BudgetTap(text) || freeTextPatch.budgetBand || null;

  if (!budgetBand) {
    // Never silently default \u2014 re-ask the same budget question,
    // keeping whatever else (if anything) this message extracted.
    const mergedProfile = mergeFlowV2Profile(profile, freeTextPatch);
    return askBudget(mergedProfile);
  }

  const patch = { budgetBand };
  // [ Under \u20B92L ] sets scholarshipFlag = true; the other two bands
  // leave it at the schema default (null), never an explicit false.
  if (budgetBand === 'under_2l') patch.scholarshipFlag = true;
  for (const [key, value] of Object.entries(freeTextPatch)) {
    if (!(key in patch)) patch[key] = value;
  }
  const mergedProfile = mergeFlowV2Profile(profile, patch);

  if (isFilled(mergedProfile.cityPref)) {
    // Reachable either via case (c)'s pre-filled cityPref, or an
    // over-answering budget reply that also named a city \u2014 either
    // way, location has already been answered, so skip straight to B4.
    return handleB4Entry(withMergedProfile(ctx, mergedProfile));
  }

  return askLocation(mergedProfile, { sequential: true });
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB3LocationReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const freeTextPatch = extractFlowV2Slots(text, profile);
  const cityPref = extractB3LocationTap(text) || freeTextPatch.cityPref || null;

  if (!cityPref) {
    // Never silently default. Re-asks with the "only question" copy
    // (no "Last one" prefix) regardless of how this stage was reached \u2014
    // the prefix's purpose (signal "this is the 2nd of 2") was already
    // served on the first send and doesn't need literal repetition.
    const mergedProfile = mergeFlowV2Profile(profile, freeTextPatch);
    return askLocation(mergedProfile, { sequential: false });
  }

  const patch = { cityPref };
  for (const [key, value] of Object.entries(freeTextPatch)) {
    if (!(key in patch)) patch[key] = value;
  }
  const mergedProfile = mergeFlowV2Profile(profile, patch);
  // This is the LAST question of the beat \u2014 no further question may
  // follow it under any circumstance; always advances straight to B4.
  return handleB4Entry(withMergedProfile(ctx, mergedProfile));
}

/**
 * @param {{ flowV2?: { stage?: string, profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB3Reply(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'b3_awaiting_location') return handleB3LocationReply(ctx, text);
  // Defensive default (should only be reachable via 'b3_awaiting_budget'
  // per the dispatcher's own wiring) \u2014 treats anything else as the
  // budget question still being pending, rather than crashing.
  return handleB3BudgetReply(ctx, text);
}

module.exports = {
  handleB3Entry,
  handleB3Reply,
  // exported for focused unit testing
  extractB3BudgetTap,
  extractB3LocationTap,
  BUDGET_QUESTION,
  LOCATION_QUESTION_ONLY,
  LOCATION_QUESTION_SEQUENTIAL,
  // exported (Phase 6) so B5's "Change something" loop can re-show these
  // exact same buttons for a budget/location change, instead of a second,
  // possibly-drifting copy of the same three-button UI living in
  // b5Shortlist.js.
  BUDGET_BUTTONS,
  LOCATION_BUTTONS,
};
