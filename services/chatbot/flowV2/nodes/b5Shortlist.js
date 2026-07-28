'use strict';

/**
 * Flow v2 — B5 · Shortlist.
 *
 * The first Flow v2 beat that produces real recommendation output. Reuses
 * the existing, already-exported, synchronous recommendation matrix
 * (`careerCounsellingV2RecommendationMatrix.js` — `scoreEligibleColleges`,
 * `tierRecommendations`, `calculateRecommendationConfidence`) and the
 * existing 10-college catalog (`CURATED_MODERN_CATALOG`). This is genuine
 * reuse of the actual scoring/tiering algorithm, not a reimplementation.
 *
 * KNOWN, DELIBERATE DUPLICATION — see
 * docs/KNOWN-ISSUE-CATALOG-SCORING-UNIFORMITY.md for the full writeup:
 * the matrix, fed through the catalog as-is, scores all 10 curated
 * colleges IDENTICALLY (verified empirically — every college ties at the
 * same score) because the catalog carries no real fee/address/branch data.
 * The only thing that currently breaks that tie in the existing codebase —
 * including giving NIAT its edge — is a small tag-matching heuristic,
 * `justifiedCuratedBoost()`, which (along with the catalog-shape adapter,
 * `curatedCatalogAsColleges()`) is PRIVATE/unexported in
 * `careerCounsellingV2ShortlistingEngine.js`. Flow v2 cannot modify that
 * file's exports (isolation contract), so `mapCuratedCatalogToMatrixColleges`
 * and `applyCuratedTieBreakBoost` below are near-verbatim local ports of
 * those two private helpers. This is a deliberate, temporary duplication
 * with a known expiry: if/when the linked ticket is fixed, both this file
 * and the old-V2 original should be revisited together.
 */

const {
  scoreEligibleColleges,
  tierRecommendations,
  calculateRecommendationConfidence,
} = require('../../careerCounselling/careerCounsellingV2RecommendationMatrix');
const { CURATED_MODERN_CATALOG } = require('../../../../constants/careerCounsellingV2ExploreModernColleges');
const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile } = require('../flowV2NodeUtils');
const { buildB1ListInteractive, B1_QUESTION_TAIL } = require('./b1Goal');
const { buildB2ListInteractive, B2_QUESTION } = require('./b2Branch');
const {
  BUDGET_QUESTION,
  BUDGET_BUTTONS,
  LOCATION_QUESTION_ONLY,
  LOCATION_BUTTONS,
  extractB3BudgetTap,
  extractB3LocationTap,
} = require('./b3Constraints');

// ---------------------------------------------------------------------------
// Adapter: Flow v2 profile -> old-V2 matrix-profile vocabulary.
// ---------------------------------------------------------------------------

/**
 * Not every Flow v2 goalPriority label has a faithful 1:1 old-V2
 * equivalent — documented here rather than forcing a lossy/misleading
 * mapping silently. Only `placement` maps cleanly onto the old
 * `evaluationPriorities` keyword set the matrix's `scoreEvaluationPriorities`
 * checks against (`projects`/`industry`/`mentoring`/`curriculum`/`placements`).
 * `ai_future_tech`, `affordable`, `fee`, `higher_studies`, `startup`,
 * `entrepreneurship` have no honest equivalent in that keyword set and are
 * left unmapped for THIS dimension (they still drive B5's own goalPriority-
 * tied reply copy and the tie-break boost below, just not this one old-V2
 * dimension).
 */
const GOAL_PRIORITY_TO_EVALUATION_PRIORITY = Object.freeze({
  placement: 'placements',
});

const GOAL_PRIORITY_TO_CAREER_TEXT = Object.freeze({
  placement: 'placements',
  ai_future_tech: 'AI and future tech',
  affordable: 'affordable fees',
  fee: 'affordable fees',
  higher_studies: 'higher studies later',
  startup: 'startup and entrepreneurship',
  entrepreneurship: 'startup and entrepreneurship',
});

const BRANCH_TO_PREFERRED_COURSE = Object.freeze({
  cse_ai: 'Computer Science / AI Engineering',
  cse: 'Computer Science Engineering',
  it: 'Information Technology Engineering',
  design: 'Design Engineering',
  data_analytics: 'Data Science / Analytics Engineering',
});

/**
 * Flow v2's `budgetBand` is already a coarse BAND, not free text — the old
 * matrix's `parseBudgetCeiling()` expects free text it can re-derive a
 * ceiling number from. This hands back a representative string chosen so
 * `parseBudgetCeiling()` lands on an equivalent ceiling, not the band label
 * itself. `5l_plus` (and the free-text-extractor's `above_10l`) are
 * deliberately phrased as open-ended so `parseBudgetCeiling()`'s own
 * `flex|high|no (limit|issue)` fallback returns a `null` ceiling (treated
 * as "no hard cap", not falsely bucketed as a specific figure).
 */
function mapBudgetBandToPreference(budgetBand) {
  switch (budgetBand) {
    case 'under_2l':
      return 'under 2 lakhs';
    case '2_5l':
      return '5 lakhs';
    case '5l_plus':
      return 'flexible, 5 lakhs or more';
    // Reachable via an R3/R4 over-answer using the generic 5-tier
    // free-text extractor rather than B3's own 3-button UI.
    case '2_4l':
      return '4 lakhs';
    case '4_6l':
      return '6 lakhs';
    case '6_10l':
      return '10 lakhs';
    case 'above_10l':
      return 'flexible, more than 10 lakhs';
    default:
      return null;
  }
}

function mapCityPrefToLocation(cityPref) {
  const stance = String(cityPref || '').toLowerCase();
  if (!stance) return { preferredLocation: null, relocationPreference: null };
  if (stance === 'open_to_move' || stance === 'metro') {
    return { preferredLocation: null, relocationPreference: 'open' };
  }
  if (stance === 'near_home') return { preferredLocation: null, relocationPreference: null };
  // A real city name (e.g. 'Hyderabad'), not a relocation stance.
  return { preferredLocation: cityPref, relocationPreference: null };
}

/**
 * @param {object} profile - a Flow v2 profile
 * @returns {object} old-V2-shaped profile fragment, just enough for
 *   `scoreEligibleColleges()`/`calculateRecommendationConfidence()` to read.
 */
function mapFlowV2ProfileToMatrixProfile(profile = {}) {
  const goalPriority = Array.isArray(profile.goalPriority) ? profile.goalPriority : [];
  const primaryGoal = goalPriority[0] || null;
  const branch = String(profile.branchInterest || '').toLowerCase();
  const { preferredLocation, relocationPreference } = mapCityPrefToLocation(profile.cityPref);
  const careerText = primaryGoal ? GOAL_PRIORITY_TO_CAREER_TEXT[primaryGoal] || primaryGoal : null;

  return {
    preferredCourse: BRANCH_TO_PREFERRED_COURSE[branch] || 'B.Tech / Engineering',
    careerGoal: careerText,
    careerPriority: careerText,
    evaluationPriorities: goalPriority.map((g) => GOAL_PRIORITY_TO_EVALUATION_PRIORITY[g]).filter(Boolean),
    budgetPreference: mapBudgetBandToPreference(profile.budgetBand),
    preferredLocation,
    relocationPreference,
  };
}

// ---------------------------------------------------------------------------
// Adapter: curated catalog -> matrix college shape (duplicated — see header).
// ---------------------------------------------------------------------------

/**
 * DUPLICATED (near-verbatim) from careerCounsellingV2ShortlistingEngine.js's
 * private, unexported `curatedCatalogAsColleges()`. See this file's header
 * and docs/KNOWN-ISSUE-CATALOG-SCORING-UNIFORMITY.md.
 */
function mapCuratedCatalogToMatrixColleges() {
  return CURATED_MODERN_CATALOG.map((item) => ({
    college_name: item.name,
    college_address: '',
    district_enum: '',
    ownership: 'private',
    _curatedId: item.id,
    _curatedTags: item.tags || [],
    _curatedWhy: item.why || '',
    _curatedModel: item.model || null,
    branches: [
      { branch_name: 'Computer Science / Emerging Tech', branch_code: 'CSE', fee: null, cutoff: null },
    ],
  }));
}

/**
 * Built from Flow v2's OWN native profile fields (goalPriority/
 * branchInterest/coreInterest) rather than round-tripping through the
 * adapted matrix-profile shape above — more faithful to what the student
 * actually said. Slugs are de-underscored to spaced words (`ai_future_tech`
 * -> `ai future tech`) so the `\bai\b`-style word-boundary regexes below
 * (ported verbatim from the old-V2 original, which was written expecting
 * natural free text, not underscored slugs) still match correctly.
 */
function flowV2ProfileSignalBlob(profile = {}) {
  return [
    ...(Array.isArray(profile.goalPriority) ? profile.goalPriority : []),
    profile.branchInterest,
    profile.coreInterest,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/**
 * DUPLICATED (near-verbatim) from careerCounsellingV2ShortlistingEngine.js's
 * private `justifiedCuratedBoost()`/`profileSignalBlob()`. Same duplication
 * note as `mapCuratedCatalogToMatrixColleges()` above. Tag-vocabulary
 * mismatches (e.g. Flow v2's `goalPriority: ['placement']` singular vs. a
 * catalog tag of `'placements'` plural) are a known, accepted imprecision
 * of this port — not worth a bespoke pluralization patch for a duplicate
 * that is itself meant to be temporary.
 */
function applyCuratedTieBreakBoost(sourceCollege, profile = {}) {
  const blob = flowV2ProfileSignalBlob(profile);
  const tags = Array.isArray(sourceCollege._curatedTags) ? sourceCollege._curatedTags : [];
  let boost = 0;
  for (const tag of tags) {
    if (blob.includes(String(tag).replace(/_/g, ' ')) || blob.includes(String(tag))) {
      boost += 0.03;
    }
  }
  const id = String(sourceCollege._curatedId || '');
  const name = String(sourceCollege.college_name || '');
  if (id === 'niat' || /\bniat\b/i.test(name)) {
    if (/\bai\b|artificial intelligence|machine learning|projects?|industry|mentor|internship|hands.?on/.test(blob)) {
      boost += 0.1;
    }
  }
  return Math.min(0.2, boost);
}

// ---------------------------------------------------------------------------
// Scoring / tiering (real reuse — no local reimplementation of this part).
// ---------------------------------------------------------------------------

function computeTiers(profile) {
  const matrixProfile = mapFlowV2ProfileToMatrixProfile(profile);
  const sourceColleges = mapCuratedCatalogToMatrixColleges();
  const scored = scoreEligibleColleges(sourceColleges, matrixProfile);
  const boosted = scored.map((row) => {
    const source = sourceColleges.find((c) => c.college_name === row.collegeName) || {};
    const boost = applyCuratedTieBreakBoost(source, profile);
    return {
      ...row,
      matchScore: Math.min(1, Number(row.matchScore || 0) + boost),
      _curatedId: source._curatedId || null,
      _curatedTags: Array.isArray(source._curatedTags) ? source._curatedTags : [],
      _curatedWhy: source._curatedWhy || '',
    };
  });
  const tiers = tierRecommendations(boosted);
  const confidence = calculateRecommendationConfidence(matrixProfile, tiers, sourceColleges.length);
  return { tiers, confidence };
}

function flattenShortlist(tiers) {
  const tagged = [
    ...tiers.bestMatch.map((c) => ({ ...c, tier: 'best_match' })),
    ...tiers.strongAlternatives.map((c) => ({ ...c, tier: 'strong_alternative' })),
    ...tiers.worthExploring.map((c) => ({ ...c, tier: 'worth_exploring' })),
  ];
  return tagged.map((c) => ({
    collegeName: c.collegeName,
    tier: c.tier,
    matchScore: c.matchScore,
    why: c._curatedWhy || null,
  }));
}

// ---------------------------------------------------------------------------
// Reply copy (Flow-v2-owned — not reused from old V2's own message set).
// ---------------------------------------------------------------------------

/** Noun/adjectival phrases only — each one must read naturally after the
 * fixed "It's also \u2026" connector in `collegeLine()` below. */
const GOAL_FRAME_LINE = Object.freeze({
  placement: 'geared toward getting you placement-ready',
  ai_future_tech: 'aligned with the AI and future-tech direction you picked',
  affordable: 'a strong pick against your affordability priority',
  fee: 'a strong pick against your affordability priority',
  higher_studies: 'a solid base if you go on to higher studies',
  startup: 'a good fit if a startup path is on your mind',
  entrepreneurship: 'a good fit if a startup path is on your mind',
});

/**
 * ★ CORE-INTEREST PAYOFF — verbatim per task spec. Only ever appended to
 * NIAT's line, and only when NIAT is specifically the best-match college.
 *
 * ⚠ UNVERIFIED ASSUMPTION, restated from the task (not silently shipped):
 * this makes a factual claim about NIAT's actual curriculum (robotics/
 * automation/BIM/embedded project work) that has not been confirmed against
 * any source in this codebase. Confirm before this ships to real students.
 */
const CORE_INTEREST_PAYOFF = Object.freeze({
  mechanical:
    'Their project work runs into robotics and automation, which is exactly where your mechanical interest points.',
  civil:
    'Their project and simulation work lines up with the BIM and smart-infrastructure direction civil is heading.',
  ece: 'Their embedded and hardware-adjacent project work keeps your ECE interest genuinely in play.',
});

/** The core-interest payoff (see `appendCoreInterestPayoff` below) is
 * applied separately by the caller, not here — this function only builds
 * the goalPriority-tied base sentence every college line starts from. */
function collegeLine(item, goalPriority) {
  const primaryGoal = (goalPriority || [])[0];
  const frame = GOAL_FRAME_LINE[primaryGoal];
  const rawBase = item.why || 'A strong option worth considering.';
  const base = /[.!?]$/.test(rawBase.trim()) ? rawBase.trim() : `${rawBase.trim()}.`;
  return frame ? `${base} It\u2019s also ${frame}.` : base;
}

function appendCoreInterestPayoff(line, coreInterest) {
  const payoff = CORE_INTEREST_PAYOFF[String(coreInterest || '').toLowerCase()];
  return payoff ? `${line} ${payoff}` : line;
}

const TIER_HEADERS = Object.freeze({
  best_match: '*Best Match*',
  strong_alternative: '*Strong Alternatives*',
  worth_exploring: '*Worth Exploring*',
});

function buildShortlistBody(shortlistArray, profile) {
  const byTier = {
    best_match: shortlistArray.filter((c) => c.tier === 'best_match'),
    strong_alternative: shortlistArray.filter((c) => c.tier === 'strong_alternative'),
    worth_exploring: shortlistArray.filter((c) => c.tier === 'worth_exploring'),
  };
  const sections = [];
  for (const tier of ['best_match', 'strong_alternative', 'worth_exploring']) {
    const items = byTier[tier];
    if (!items.length) continue;
    sections.push(TIER_HEADERS[tier]);
    for (const item of items) {
      let line = collegeLine(item, profile.goalPriority);
      // CORE-INTEREST PAYOFF: only if coreInterest is set AND this
      // college is specifically in the best-match slot.
      if (tier === 'best_match' && profile.coreInterest && /\bniat\b/i.test(item.collegeName)) {
        line = appendCoreInterestPayoff(line, profile.coreInterest);
      }
      sections.push(`- *${item.collegeName}* \u2014 ${line}`);
    }
    sections.push('');
  }
  sections.push('Want me to compare them, just tell you the best fit, or change something first?');
  return sections.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').trim();
}

const B5_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b5_compare', title: 'Compare them' }),
  Object.freeze({ id: 'flowv2_b5_best_fit', title: 'Just the best fit' }),
  Object.freeze({ id: 'flowv2_b5_change', title: 'Change something' }),
]);
const B5_REASK_BODY = "No worries \u2014 which would you like?";

const CHANGE_SLOT_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_b5_change_budget', title: 'Budget' }),
  Object.freeze({ id: 'flowv2_b5_change_location', title: 'Location' }),
  Object.freeze({ id: 'flowv2_b5_change_field', title: 'Field' }),
  Object.freeze({ id: 'flowv2_b5_change_priorities', title: 'What matters' }),
]);
const CHANGE_SLOT_QUESTION = 'Which would you like to change?';

// ---------------------------------------------------------------------------
// Node entry / reply.
// ---------------------------------------------------------------------------

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB5Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const { tiers } = computeTiers(profile);
  const shortlistArray = flattenShortlist(tiers);

  // `shortlist` is intentionally NOT run through mergeFlowV2Profile's
  // generic array-type handling (concat + dedupe by collegeName) — every
  // handleB5Entry call (including the "Change something" re-run below)
  // computes a FRESH, complete shortlist that must fully REPLACE the
  // previous one. A concat+dedupe would silently keep the OLDER tier/score
  // for every college name (dedupeArray() keeps first-seen), which would
  // make "Change something" a visible no-op.
  const nextProfile = { ...profile, shortlist: shortlistArray };

  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: buildShortlistBody(shortlistArray, profile),
      buttons: B5_BUTTONS,
    },
    contextPatch: { stage: 'b5_awaiting_reply', profile: nextProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function reAskB5(profile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: { type: 'button', body: B5_REASK_BODY, buttons: B5_BUTTONS },
    contextPatch: { stage: 'b5_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function askChangeSlotMenu(profile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'list',
      body: CHANGE_SLOT_QUESTION,
      buttonText: 'Select',
      sections: [{ title: 'Change something', rows: CHANGE_SLOT_ROWS }],
    },
    contextPatch: { stage: 'b5_change_awaiting_slot', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function askChangeValueQuestion(profile, slot) {
  const contextPatch = { stage: 'b5_change_awaiting_value', profile, changingSlot: slot };
  const base = {
    replyText: null,
    replyParts: null,
    contextPatch,
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
  if (slot === 'goalPriority') {
    return { ...base, interactive: buildB1ListInteractive(B1_QUESTION_TAIL) };
  }
  if (slot === 'branchInterest') {
    return { ...base, interactive: buildB2ListInteractive(B2_QUESTION) };
  }
  if (slot === 'budgetBand') {
    return { ...base, interactive: { type: 'button', body: BUDGET_QUESTION, buttons: BUDGET_BUTTONS } };
  }
  // cityPref
  return { ...base, interactive: { type: 'button', body: LOCATION_QUESTION_ONLY, buttons: LOCATION_BUTTONS } };
}

const B5_ACTION_PATTERNS = Object.freeze([
  Object.freeze({ re: /\bcompare\b/i, action: 'compare' }),
  Object.freeze({ re: /\bbest fit\b|\bjust the best\b|\bbest one\b/i, action: 'best_only' }),
  Object.freeze({ re: /\bchange\b/i, action: 'change' }),
]);
function extractB5Action(text) {
  const t = String(text || '');
  for (const { re, action } of B5_ACTION_PATTERNS) {
    if (re.test(t)) return action;
  }
  return null;
}

const CHANGE_SLOT_PATTERNS = Object.freeze([
  Object.freeze({ re: /\bbudget\b/i, slot: 'budgetBand' }),
  Object.freeze({ re: /\blocation\b/i, slot: 'cityPref' }),
  Object.freeze({ re: /\bfield\b/i, slot: 'branchInterest' }),
  Object.freeze({ re: /\bwhat matters\b|\bpriorit(y|ies)\b/i, slot: 'goalPriority' }),
]);
function extractChangeSlotChoice(text) {
  const t = String(text || '');
  for (const { re, slot } of CHANGE_SLOT_PATTERNS) {
    if (re.test(t)) return slot;
  }
  return null;
}

function advanceToB6(profile, compareMode) {
  return {
    replyText: null,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: 'b6_awaiting_entry', compareMode, profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB5ChangeSlotReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const slot = extractChangeSlotChoice(text);
  // Never silently default to a slot the student didn't pick — re-show the menu.
  if (!slot) return askChangeSlotMenu(profile);
  return askChangeValueQuestion(profile, slot);
}

function handleB5ChangeValueReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const slot = ctx?.flowV2?.changingSlot;
  const freeTextPatch = extractFlowV2Slots(text, profile);

  let newValue = null;
  if (slot === 'goalPriority') newValue = freeTextPatch.goalPriority || null;
  else if (slot === 'branchInterest') newValue = freeTextPatch.branchInterest || null;
  else if (slot === 'budgetBand') newValue = extractB3BudgetTap(text) || freeTextPatch.budgetBand || null;
  else if (slot === 'cityPref') newValue = extractB3LocationTap(text) || freeTextPatch.cityPref || null;

  const isEmpty = newValue == null || (Array.isArray(newValue) && newValue.length === 0);
  if (!slot || isEmpty) {
    // Couldn't confidently extract a value for the chosen slot — re-ask
    // that same slot's question rather than silently giving up or
    // defaulting to something the student didn't say.
    return askChangeValueQuestion(profile, slot || 'budgetBand');
  }

  let mergedProfile;
  if (slot === 'goalPriority') {
    // A "change" REPLACES the priority list, it does not accumulate onto
    // the old one (mergeFlowV2Profile's array handling would concat +
    // dedupe, which is the wrong semantics for "I changed my mind").
    mergedProfile = { ...profile, goalPriority: newValue };
  } else {
    const patch = { [slot]: newValue };
    if (slot === 'budgetBand' && newValue === 'under_2l') patch.scholarshipFlag = true;
    mergedProfile = mergeFlowV2Profile(profile, patch);
  }

  // Field=core-engineering re-selected here must NEVER re-trigger the B2.2
  // fork. This function only ever calls back into handleB5Entry below — it
  // does not import or call anything from b2Branch.js/b2CoreFork.js — so
  // the fork is structurally unreachable from this path regardless of the
  // new branchInterest value (verified by a dedicated test, not just
  // trusted from this comment).
  return handleB5Entry(withMergedProfile(ctx, mergedProfile));
}

/**
 * @param {{ flowV2?: { stage?: string, profile?: object, changingSlot?: string } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB5Reply(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'b5_change_awaiting_slot') return handleB5ChangeSlotReply(ctx, text);
  if (stage === 'b5_change_awaiting_value') return handleB5ChangeValueReply(ctx, text);

  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const action = extractB5Action(text);

  if (action === 'compare') return advanceToB6(profile, 'full');
  if (action === 'best_only') return advanceToB6(profile, 'best_only');
  if (action === 'change') return askChangeSlotMenu(profile);

  // Free-typed text that doesn't confidently match any of the three
  // meanings — reuse the same shortened re-ask pattern established by
  // Greeting/B1/B2, rather than inventing new ambiguous-input handling.
  return reAskB5(profile);
}

module.exports = {
  handleB5Entry,
  handleB5Reply,
  // exported for focused unit testing / reuse
  mapFlowV2ProfileToMatrixProfile,
  mapCuratedCatalogToMatrixColleges,
  applyCuratedTieBreakBoost,
  computeTiers,
  flattenShortlist,
  buildShortlistBody,
  extractB5Action,
  extractChangeSlotChoice,
  CORE_INTEREST_PAYOFF,
  B5_BUTTONS,
  CHANGE_SLOT_ROWS,
};
