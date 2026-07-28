'use strict';

/**
 * Flow v2 — R4-P · College Predictor (real-API prediction, isolated node).
 *
 * THIS FILE IS BEING BUILT IN STAGES, REVIEWED SEPARATELY, PER EXPLICIT
 * INSTRUCTION. Do not assume anything beyond what a given stage's own
 * section below documents is actually implemented yet.
 *
 *   STAGE 1 (built, reviewed): \u2460 the hard-blocked demographic case only
 *     (AP EAMCET + OC + Male) \u2014 the highest-safety-stakes piece, built
 *     and reviewed first, on its own, before any slot-filling existed.
 *   STAGE 2 (THIS DELIVERY): \u2461 exam-specific slot filling. Ends with
 *     "all required slots known" \u2014 does NOT call the prediction API
 *     (that is Stage 3) and does NOT resolve slots into the numeric
 *     reservation codes the real API call eventually needs (also Stage 3).
 *   STAGE 3 (not yet built): \u2462 the real prediction API call (happy path).
 *   STAGE 4 (not yet built): \u2463 sticky results (button-based Show More /
 *     filters / Help me choose).
 *   STAGE 5 (not yet built): \u2464 the honest two-catalog bridge back into
 *     B1/B2.
 *
 * `handleR4PReply` still throws an explicit, named error for any stage
 * this node does not yet cover (now: anything other than
 * `R4P_BLOCKED_STAGE` and `R4P_SLOT_STAGE`) \u2014 deliberately, so nothing
 * downstream can mistake an unbuilt code path for a silently "working"
 * one. `R4P_AWAITING_PREDICTION_STAGE` (Stage 2's own exit state) is a
 * documented placeholder with NO handler here by design \u2014 see that
 * constant's own doc for why, and why that is the correct, established
 * precedent for an intentionally partial node, not a bug.
 *
 * ASYNC CONTRACT: unchanged from Stage 1 \u2014 this node is built against
 * the now-async `processFlowV2Turn`. Stage 2's own functions below are
 * still fully synchronous (slot-filling needs no network call) \u2014 the
 * real `await` boundary (Stage 3's `fetchCollegeDostColleges` call) lands
 * in a later stage.
 *
 * ISOLATION (per explicit instruction for this whole node, unchanged for
 * Stage 2): no existing `careerCounsellingV2*.js` file is touched, and
 * `flowV2Dispatcher.js` is NOT touched by this file either \u2014 R4-P is
 * still not wired into stage-based routing. Every new test below (except
 * the one placeholder-fallthrough test, which deliberately needs the
 * real dispatcher to prove the "unrecognized stage" property) calls
 * `handleR4PEntry`/`handleR4PReply` directly, exactly like Stage 1's own
 * tests do.
 *
 * \u2460 BLOCKED CASE \u2014 AP EAMCET + OC + Male (Stage 1, unchanged)
 *
 * See the original Stage 1 documentation (preserved below, still
 * accurate) for the full blocked-case rationale. THE FIRST CHECK
 * discipline is UNCHANGED and, if anything, now MORE load-bearing:
 * `isBlockedDemographic()` is called on every merged profile produced by
 * Stage 2's own slot-filling reply handler too (`processSlotReply`
 * below), not only at entry \u2014 see \u2461 SLOT FILLING \u2014 ORDERING
 * GUARANTEE further down for why a single check at entry time alone is
 * no longer sufficient once slot-filling exists.
 *
 * `whatsappCollegePredictor/apTs.js`'s `isApOcMaleBlocked(categoryId,
 * gender)` is the existing, shared source of truth for this rule \u2014
 * imported and called as-is below, never reimplemented. It compares a
 * NUMERIC category id against `gender === 'male'`. Flow v2's own
 * `LEAD_PROFILE_SCHEMA.category` is documented to hold a human-readable
 * LABEL ("OC", "BC-A", ...), not that numeric id \u2014
 * `resolveApTsCategoryId()` below is the one small adapter needed to
 * bridge the two, accepting either the documented label or (defensively)
 * a bare numeric id/string.
 *
 * PROVENANCE OF THE id VALUES (asked and confirmed explicitly \u2014 not a
 * guess): `resolveApTsCategoryId()` does not hardcode a single id
 * anywhere. It searches `AP_TS_CATEGORY_OPTIONS`, imported live from
 * `apTs.js` \u2014 the exact same canonical table `isApOcMaleBlocked`,
 * `resolveApTsReservationCode`, and the old flow's `mapCategoryChoice`/
 * `CATEGORY_MENU` (constants/whatsappCollegePredictor.js) already key
 * off of. The numeric-id branch reuses that same file's exported
 * `mapById()` helper (already reused by the old flow's
 * `collegePredictorSlotExtractor.js`) rather than a second inline
 * `.find()`.
 *
 * DELIBERATELY NOT GENERAL-PURPOSE \u2014 AP/TS EAMCET ONLY. Named
 * `resolveApTsCategoryId`, not `resolveCategoryIdFromLabel`, on purpose
 * (unchanged conclusion from the Stage-1/Stage-2 checkpoint review):
 * `isApOcMaleBlocked` only ever applies to AP EAMCET, so this adapter
 * only ever needs to search `AP_TS_CATEGORY_OPTIONS`. Stage 2's own
 * category question (see \u2461 below) deliberately does NOT reuse
 * `collegePredictorSlots.js`'s per-exam `categoryOptionsForExam()` table
 * either \u2014 see \u2461 CATEGORY \u2014 SCOPE DECISION below for why, and what
 * is explicitly deferred to Stage 3 instead.
 *
 * NODE 0 HANDOFF, NOT A DUPLICATE PATH \u2014 [Connect me] (Stage 1,
 * unchanged): see the original comment block, preserved verbatim further
 * below near `BLOCKED_BUTTONS`.
 *
 * \u2461 SLOT FILLING (Stage 2)
 *
 * SLOT ORDER \u2014 reused, not reimplemented. `collegePredictorSlots.js`'s
 * `slotOrderForExam(exam)` is the single source of truth for which slots
 * a given exam needs and in what order; this file never encodes its own
 * copy of that table. The one adapter needed: `slotOrderForExam()`
 * expects the OLD flow's own `EXAM_*` constants
 * (`constants/whatsappCollegePredictor.js`), and three of Flow v2's own
 * canonical `examType` values do not textually match those constants
 * (`JEE_MAIN`/`JEE_ADVANCED`/`WBJEE`/`MHT_CET` vs. the old flow's
 * year-tagged `JEE_MAINS_2024`/`JEE_ADVANCE_2024`/`WBJEE_2024`/`MHTCET`)
 * \u2014 `LEGACY_EXAM_BY_FLOWV2_EXAM` below is that bridge, the same kind of
 * adapter `resolveApTsCategoryId` already established a precedent for.
 * AP_EAMCET/TS_EAMCET/TNEA/KCET/KEAM happen to already match verbatim
 * (confirmed empirically, not assumed) and are still listed in the map
 * for symmetry/clarity, not because they strictly need translating.
 *
 * ORDERING GUARANTEE \u2014 the blocked check runs on EVERY slot-filling
 * reply, not only at entry. This is a STRONGER guarantee than what was
 * literally asked for (only re-checking "at completion time"), and is
 * necessary for correctness: `isBlockedDemographic()` only depends on
 * `examType` + `category` + `gender` \u2014 it can become true the instant
 * those three are known, which can happen BEFORE every AP EAMCET slot
 * (rank, region) is filled. Deferring the check to "only once slots are
 * nominally complete" would let a message that fills category+gender
 * (but not yet rank/region) sail past this gate for one more turn.
 * `processSlotReply()` below checks `isBlockedDemographic(mergedProfile)`
 * immediately after every merge, before computing missing slots or
 * deciding the next question \u2014 see the dedicated precedence tests in
 * `test/flowV2R4PPredictor.test.js`.
 *
 * CATEGORY \u2014 SCOPE DECISION (flagged, not silently guessed). Stage 2
 * asks category using ONE shared, exam-agnostic 10-option list (OC,
 * BC-A..E, SC, ST, EWS, General \u2014 backed entirely by the ALREADY-COMPLETE
 * generic `extractFlowV2Slots`/`extractCategory`), the same for every
 * exam, rather than reusing `collegePredictorSlots.js`'s per-exam
 * `categoryOptionsForExam()` tables (which range from AP/TS's 9 options
 * up to MHT-CET's ~40 raw reservation codes \u2014 far past what a WhatsApp
 * list can present, and KEAM's 17 options are already at the edge).
 * This is a deliberate, scope-appropriate simplification for a stage
 * whose own stated goal is "all slots known", not "reservation-code-
 * ready": Stage 2 captures a confident, real category VALUE (never a
 * fabricated one \u2014 unrecognized answers re-ask, exactly like every
 * other slot here), but the harder per-exam numeric-code resolution
 * (`resolveApTsReservationCode` / `getWbjeeReservationCategoryCode` /
 * `getJeeReservationCategoryCodes` / `normalizeMhtReservationCodeForApi`
 * / `categoryOptionsForExam`) is Stage 3's job when the real API call
 * actually needs it \u2014 Stage 2 never calls the API, so it does not need
 * that resolution today. KCET/WBJEE/MHT-CET's own exam-specific category
 * codes (e.g. "1G", "GOPENS") are consequently NOT recognized by Stage
 * 2's category question yet; an answer using one of those codes re-asks
 * rather than accepting an un-normalized value it cannot yet resolve.
 * Tracked here explicitly rather than fabricated as "done" \u2014 a natural
 * Stage 3 follow-up, not a Stage 2 regression, since Stage 2 was never
 * asked to reach reservation-code correctness.
 *
 * ADMISSION TYPE \u2014 NOT IN THE ORIGINAL FIELD LIST, ADDED ANYWAY (flagged).
 * The task's own "confirm the extractor already handles X" list named
 * exam/rank/percentile/category/gender/quota/region, but the SLOT ORDER
 * table for KCET and MHT-CET both require `admission_type` between rank/
 * percentile and category \u2014 without it, those two exams could never
 * reach "all slots known". Added as a new, additive `admissionType`
 * schema slot (`constants/careerCounsellingFlowV2Profile.js`) and handled
 * here as a NODE-LOCAL tap recognizer (`extractR4PAdmissionTypeTap`),
 * deliberately NOT added to the shared `extractFlowV2Slots` \u2014 see that
 * function's own doc comment for why (KCET's "General" option collides
 * with the shared extractor's existing generic category keyword list).
 * This mirrors the exact precedent `b3Constraints.js` already
 * established (`extractB3BudgetTap`/`extractB3LocationTap`) for slots
 * whose own button vocabulary is a poor fit for the shared, general-
 * purpose extractor.
 */

const {
  EXAM_TNEA,
  EXAM_KCET,
  EXAM_KEAM,
  EXAM_WBJEE,
  EXAM_JEE_MAIN,
  EXAM_JEE_ADV,
  EXAM_MHT,
  mapById,
} = require('../../../../constants/whatsappCollegePredictor');
const { isApOcMaleBlocked, AP_TS_CATEGORY_OPTIONS, AP_REGION_OPTIONS, EXAM_AP, EXAM_TS } = require('../../whatsappCollegePredictor/apTs');
const { WBJEE_QUOTA_OPTIONS } = require('../../whatsappCollegePredictor/wbjee');
const { KCET_ADMISSION_OPTIONS } = require('../../whatsappCollegePredictor/kcet');
const { MHT_CET_ADMISSION_OPTIONS } = require('../../whatsappCollegePredictor/mhtCet');
const {
  slotOrderForExam,
  SLOT_EXAM,
  SLOT_RANK,
  SLOT_PERCENTILE,
  SLOT_ADMISSION_TYPE,
  SLOT_CATEGORY,
  SLOT_GENDER,
  SLOT_QUOTA,
  SLOT_REGION,
} = require('../../whatsappCollegePredictor/collegePredictorSlots');
const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');

// PROVENANCE (same discipline as resolveApTsCategoryId below) \u2014 these
// module-load-time assertions prove the value strings
// extractR4PAdmissionTypeTap() and flowV2SlotExtractor.js's extractQuota()
// return are live members of the real canonical option tables, not a
// separately maintained/guessed copy. Throws loudly (at require-time,
// long before any student input) if those tables ever change shape.
function assertCanonicalValues(options, expectedValues, tableName) {
  for (const value of expectedValues) {
    if (!options.some((opt) => opt.value === value)) {
      throw new Error(`r4pPredictor: ${tableName} no longer contains expected value "${value}" \u2014 update the adapter that depends on it.`);
    }
  }
}
assertCanonicalValues(WBJEE_QUOTA_OPTIONS, ['all_india', 'home_state_wb'], 'WBJEE_QUOTA_OPTIONS');
assertCanonicalValues(KCET_ADMISSION_OPTIONS, ['GENERAL', 'HK'], 'KCET_ADMISSION_OPTIONS');
assertCanonicalValues(
  MHT_CET_ADMISSION_OPTIONS,
  ['STATE_LEVEL', 'HOME_UNIVERSITY', 'OTHER_THAN_HOME_UNIVERSITY'],
  'MHT_CET_ADMISSION_OPTIONS'
);
assertCanonicalValues(AP_REGION_OPTIONS, ['AU', 'SVU'], 'AP_REGION_OPTIONS');

// ---------------------------------------------------------------------------
// \u2460 Blocked case \u2014 copy verbatim per task spec. UNCHANGED from Stage 1.
// ---------------------------------------------------------------------------

const BLOCKED_REPLY_TEXT =
  "For AP OC male candidates the cutoffs swing enough that I won't give you a number I can't stand behind \u2014 a wrong prediction here could cost you a year. So let me get you to someone who has the actual current data for your combination.";

const BLOCKED_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_blocked_connect_me', title: 'Connect me' }),
  Object.freeze({ id: 'flowv2_r4p_blocked_checklist', title: 'What should I look for meanwhile?' }),
]);

/** Single button re-offered after the checklist bubble \u2014 reuses the exact
 * same frozen button object as the initial offer (same id/title), not a
 * re-typed copy that could drift out of sync with it. */
const RECONNECT_BUTTONS = Object.freeze([BLOCKED_BUTTONS[0]]);
const RECONNECT_PROMPT_TEXT = 'Want me to connect you now?';

const CHECKLIST_TEXT = [
  'While that\u2019s getting set up, here\u2019s what actually matters for your combination \u2014 bring these to the call and you\u2019ll get a sharper answer, faster:',
  '\u2022 The cutoff trend for OC male, AP EAMCET, over the last 3 years \u2014 one year\u2019s number alone can mislead you.',
  '\u2022 The seat matrix for your exact category this year \u2014 seats genuinely shift year to year.',
  '\u2022 Spot-round history for the branches you\u2019re considering \u2014 some of the strongest seats only open up there.',
].join('\n');

/** Stage the blocked sub-flow parks in while awaiting [Connect me] /
 * [What should I look for meanwhile?] \u2014 exported now (even though no
 * dispatcher wiring exists yet) so later stages, and this stage's own
 * dispatcher-level Node-0-handoff test, have one real, stable name to
 * reference instead of a throwaway string. */
const R4P_BLOCKED_STAGE = 'r4p_awaiting_blocked_reply';

const CHECKLIST_PATTERN = /\bwhat should i look for meanwhile\b/i;

/**
 * AP/TS-EAMCET-ONLY adapter \u2014 see module doc's \u2460 section for why this is
 * deliberately not a general-purpose category resolver. Resolves Flow
 * v2's `profile.category` (documented as a human label \u2014 "OC", "BC-A",
 * "SC", ...) to the numeric id `isApOcMaleBlocked()` and
 * `AP_TS_CATEGORY_OPTIONS` (both from `apTs.js`) actually key on.
 * Defensively also accepts a bare numeric id/string (in case a caller
 * populates the profile that way instead) \u2014 either input shape resolves
 * to the same id. The numeric-id branch reuses the existing, shared
 * `mapById()` helper (constants/whatsappCollegePredictor.js) rather than
 * a second inline lookup.
 * @param {string|number|null|undefined} categoryValue
 * @returns {number|null}
 */
function resolveApTsCategoryId(categoryValue) {
  if (categoryValue === null || categoryValue === undefined || String(categoryValue).trim() === '') return null;
  const asNumber = Number(categoryValue);
  if (!Number.isNaN(asNumber)) {
    const byId = mapById(AP_TS_CATEGORY_OPTIONS, asNumber);
    if (byId) return byId.id;
  }
  const normalized = String(categoryValue).trim().toUpperCase();
  const byLabel = AP_TS_CATEGORY_OPTIONS.find((opt) => opt.label.toUpperCase() === normalized);
  return byLabel ? byLabel.id : null;
}

/**
 * THE FIRST CHECK \u2014 see module doc. Reuses `isApOcMaleBlocked()` as-is;
 * this function's only job is resolving Flow v2's own field shapes
 * (`examType`, `category` label, `gender`) into the inputs that shared
 * function already expects.
 * @param {object} profile
 * @returns {boolean}
 */
function isBlockedDemographic(profile) {
  const p = profile || {};
  if (p.examType !== EXAM_AP) return false;
  const categoryId = resolveApTsCategoryId(p.category);
  if (categoryId === null) return false;
  const gender = typeof p.gender === 'string' ? p.gender.trim().toLowerCase() : p.gender;
  return isApOcMaleBlocked(categoryId, gender);
}

function blockedDemographicReply(profile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: BLOCKED_REPLY_TEXT,
      buttons: BLOCKED_BUTTONS,
    },
    contextPatch: {
      stage: R4P_BLOCKED_STAGE,
      profile,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function checklistReply(profile) {
  return {
    replyText: CHECKLIST_TEXT,
    replyParts: null,
    interactive: {
      type: 'button',
      body: RECONNECT_PROMPT_TEXT,
      buttons: RECONNECT_BUTTONS,
    },
    contextPatch: {
      stage: R4P_BLOCKED_STAGE,
      profile,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

// ---------------------------------------------------------------------------
// \u2461 Slot filling (Stage 2)
// ---------------------------------------------------------------------------

/** Bridges Flow v2's clean, unversioned `examType` values to the OLD
 * flow's own (sometimes year-tagged) `EXAM_*` constants that
 * `slotOrderForExam()` actually branches on \u2014 see module doc. */
const LEGACY_EXAM_BY_FLOWV2_EXAM = Object.freeze({
  AP_EAMCET: EXAM_AP, // identical string ('AP_EAMCET') \u2014 kept for symmetry
  TS_EAMCET: EXAM_TS, // identical string ('TS_EAMCET')
  TNEA: EXAM_TNEA, // identical string ('TNEA')
  KCET: EXAM_KCET, // identical string ('KCET')
  KEAM: EXAM_KEAM, // identical string ('KEAM')
  WBJEE: EXAM_WBJEE, // Flow v2 'WBJEE' -> old flow's 'WBJEE_2024'
  JEE_MAIN: EXAM_JEE_MAIN, // Flow v2 'JEE_MAIN' -> old flow's 'JEE_MAINS_2024'
  JEE_ADVANCED: EXAM_JEE_ADV, // Flow v2 'JEE_ADVANCED' -> old flow's 'JEE_ADVANCE_2024'
  MHT_CET: EXAM_MHT, // Flow v2 'MHT_CET' -> old flow's 'MHTCET'
});

/**
 * @param {string|null} flowV2ExamType
 * @returns {string|null} the value `slotOrderForExam()` expects
 */
function resolveLegacyExam(flowV2ExamType) {
  if (!flowV2ExamType) return null;
  // Falls back to the raw value itself (rather than `null`) for any
  // examType this map doesn't recognize \u2014 defensive only; every value
  // `extractExamType()` can actually produce is listed above. A raw,
  // unmapped truthy string still lets `slotOrderForExam()` reach its own
  // final default branch (`[exam, rank, category]`) instead of silently
  // looping back to "ask exam again" for an exam we already have a value
  // for.
  return LEGACY_EXAM_BY_FLOWV2_EXAM[flowV2ExamType] || flowV2ExamType;
}

/** Maps `slotOrderForExam()`'s own slot-name vocabulary to Flow v2's
 * profile field names \u2014 the one seam between the reused old-flow order
 * logic and this node's own profile shape. */
const SLOT_PROFILE_FIELD = Object.freeze({
  [SLOT_EXAM]: 'examType',
  [SLOT_RANK]: 'rank',
  [SLOT_PERCENTILE]: 'percentile',
  [SLOT_ADMISSION_TYPE]: 'admissionType',
  [SLOT_CATEGORY]: 'category',
  [SLOT_GENDER]: 'gender',
  [SLOT_QUOTA]: 'quota',
  [SLOT_REGION]: 'region',
});

function hasR4PSlot(profile, legacySlot) {
  const field = SLOT_PROFILE_FIELD[legacySlot];
  if (!field) return false;
  const value = profile[field];
  return value !== null && value !== undefined && value !== '';
}

/** @param {object} profile @returns {string[]} legacy slot names, in order */
function getR4PSlotOrder(profile) {
  if (!profile.examType) return [SLOT_EXAM];
  return slotOrderForExam(resolveLegacyExam(profile.examType));
}

/** @param {object} profile @returns {string[]} legacy slot names still missing, in order */
function getR4PMissingSlots(profile) {
  return getR4PSlotOrder(profile).filter((slot) => !hasR4PSlot(profile, slot));
}

/** Stage the slot-filling sub-flow parks in between questions. ONE stage
 * for every slot (unlike B3's two dedicated stages) because the actual
 * pending slot varies per exam \u2014 tracked separately in
 * `context.flowV2.r4pPendingSlot` (ephemeral per-turn routing data, same
 * category as `pendingQualificationGuess` / `compareMode` /
 * `changingSlot` documented in flowV2Dispatcher.js's ctx shape, NOT a
 * LEAD_PROFILE_SCHEMA slot). */
const R4P_SLOT_STAGE = 'r4p_awaiting_slot';

/** Stage 2's own exit state once every slot required by the student's
 * exam is known. Deliberately a DEAD END within this file \u2014 no handler
 * exists for it in `handleR4PReply` below, by design, matching the exact
 * established precedent of every other "next stage doesn't exist yet"
 * boundary in this migration (`node0_awaiting_backfill`,
 * `b3_awaiting_entry` before B3 was wired, `b5_awaiting_entry` before B5
 * was wired, ...). Since this node is not wired into
 * `flowV2Dispatcher.js`'s `runStageFallthrough` at all yet, reaching this
 * stage through the real dispatcher falls through to its generic
 * `safeFallbackReply()` cleanly \u2014 proven in
 * `test/flowV2R4PPredictor.test.js` without any dispatcher change. */
const R4P_AWAITING_PREDICTION_STAGE = 'r4p_awaiting_prediction';

// --- Question copy + interactives, one per legacy slot name -----------------
// Tone note (flagged, not spec'd verbatim anywhere): none of these
// questions have exact spec copy the way \u2460's BLOCKED_REPLY_TEXT does \u2014
// written to match B1-B7's established short, direct, "why I ask" voice.

const EXAM_QUESTION_TEXT = "Which entrance exam?\nWhy I ask: cutoffs and categories work differently per exam.";
const EXAM_LIST_BUTTON_TEXT = 'Select';
const EXAM_LIST_SECTION_TITLE = 'Choose your exam';
const EXAM_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_exam_ap_eamcet', title: 'AP EAMCET' }),
  Object.freeze({ id: 'flowv2_r4p_exam_ts_eamcet', title: 'TS EAMCET' }),
  Object.freeze({ id: 'flowv2_r4p_exam_jee_main', title: 'JEE Main' }),
  Object.freeze({ id: 'flowv2_r4p_exam_jee_adv', title: 'JEE Advanced' }),
  Object.freeze({ id: 'flowv2_r4p_exam_kcet', title: 'KCET' }),
  Object.freeze({ id: 'flowv2_r4p_exam_tnea', title: 'TNEA' }),
  Object.freeze({ id: 'flowv2_r4p_exam_keam', title: 'KEAM' }),
  Object.freeze({ id: 'flowv2_r4p_exam_wbjee', title: 'WBJEE' }),
  Object.freeze({ id: 'flowv2_r4p_exam_mht_cet', title: 'MHT CET' }),
]);

const RANK_QUESTION_TEXT = "What's your rank?\nWhy I ask: it's the main number that decides which colleges are realistic.";
const PERCENTILE_QUESTION_TEXT = "What's your percentile?\nWhy I ask: your exam uses percentile, not rank, to set cutoffs.";

const CATEGORY_QUESTION_TEXT = 'Which category?\nWhy I ask: category changes the cutoff you need to clear.';
const CATEGORY_LIST_BUTTON_TEXT = 'Select';
const CATEGORY_LIST_SECTION_TITLE = 'Choose your category';
// See module doc's \u2461 CATEGORY \u2014 SCOPE DECISION for why this is one
// shared, generic list reused for every exam rather than per-exam tables.
const CATEGORY_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_category_oc', title: 'OC' }),
  Object.freeze({ id: 'flowv2_r4p_category_bca', title: 'BC-A' }),
  Object.freeze({ id: 'flowv2_r4p_category_bcb', title: 'BC-B' }),
  Object.freeze({ id: 'flowv2_r4p_category_bcc', title: 'BC-C' }),
  Object.freeze({ id: 'flowv2_r4p_category_bcd', title: 'BC-D' }),
  Object.freeze({ id: 'flowv2_r4p_category_bce', title: 'BC-E' }),
  Object.freeze({ id: 'flowv2_r4p_category_sc', title: 'SC' }),
  Object.freeze({ id: 'flowv2_r4p_category_st', title: 'ST' }),
  Object.freeze({ id: 'flowv2_r4p_category_ews', title: 'EWS' }),
  Object.freeze({ id: 'flowv2_r4p_category_general', title: 'General' }),
]);

const GENDER_QUESTION_TEXT = 'Gender?\nWhy I ask: some categories are gender-specific.';
const GENDER_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_gender_male', title: 'Male' }),
  Object.freeze({ id: 'flowv2_r4p_gender_female', title: 'Female' }),
]);

// AP-only. Short codes as button titles (not AP_REGION_OPTIONS' own
// longer labels, e.g. "SVU (Sri Venkateswara University)", which would
// exceed a comfortable WhatsApp button-title length) \u2014 values are still
// asserted against AP_REGION_OPTIONS at module load (see
// assertCanonicalValues above).
const REGION_QUESTION_TEXT = 'Which region \u2014 AU or SVU?\nWhy I ask: AP EAMCET seats are split by region.';
const REGION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_region_au', title: 'AU' }),
  Object.freeze({ id: 'flowv2_r4p_region_svu', title: 'SVU' }),
]);

// WBJEE-only. Titles kept short; values match WBJEE_QUOTA_OPTIONS
// ('home_state_wb' / 'all_india'), asserted at module load.
const QUOTA_QUESTION_TEXT = 'Which quota \u2014 home state or all India?\nWhy I ask: WBJEE reserves seats differently by quota.';
const QUOTA_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_quota_home_state', title: 'Home State' }),
  Object.freeze({ id: 'flowv2_r4p_quota_all_india', title: 'All India' }),
]);

// KCET/MHT-CET only \u2014 different option sets per exam, so buttons are
// built per legacyExam rather than one shared set. Values match
// KCET_ADMISSION_OPTIONS / MHT_CET_ADMISSION_OPTIONS, asserted at module
// load; titles are shortened where the canonical label would be too long
// for a WhatsApp button ("Other than Home University" -> "Other than Home").
const ADMISSION_TYPE_QUESTION_TEXT = 'Which admission type?\nWhy I ask: cutoffs differ by admission category.';
const KCET_ADMISSION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_admission_general', title: 'General' }),
  Object.freeze({ id: 'flowv2_r4p_admission_hk', title: 'HK' }),
]);
const MHT_ADMISSION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4p_admission_state_level', title: 'State Level' }),
  Object.freeze({ id: 'flowv2_r4p_admission_home_university', title: 'Home University' }),
  Object.freeze({ id: 'flowv2_r4p_admission_other_home', title: 'Other than Home' }),
]);

function askResult(profile, legacySlot, interactive) {
  return {
    replyText: null,
    replyParts: null,
    interactive,
    contextPatch: { stage: R4P_SLOT_STAGE, profile, r4pPendingSlot: legacySlot },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function askExam(profile) {
  return askResult(profile, SLOT_EXAM, {
    type: 'list',
    body: EXAM_QUESTION_TEXT,
    buttonText: EXAM_LIST_BUTTON_TEXT,
    sections: [{ title: EXAM_LIST_SECTION_TITLE, rows: EXAM_ROWS }],
  });
}

function askRank(profile) {
  return askResult(profile, SLOT_RANK, null);
}

function askPercentile(profile) {
  return askResult(profile, SLOT_PERCENTILE, null);
}

function askCategory(profile) {
  return askResult(profile, SLOT_CATEGORY, {
    type: 'list',
    body: CATEGORY_QUESTION_TEXT,
    buttonText: CATEGORY_LIST_BUTTON_TEXT,
    sections: [{ title: CATEGORY_LIST_SECTION_TITLE, rows: CATEGORY_ROWS }],
  });
}

function askGender(profile) {
  return askResult(profile, SLOT_GENDER, { type: 'button', body: GENDER_QUESTION_TEXT, buttons: GENDER_BUTTONS });
}

function askRegion(profile) {
  return askResult(profile, SLOT_REGION, { type: 'button', body: REGION_QUESTION_TEXT, buttons: REGION_BUTTONS });
}

function askQuota(profile) {
  return askResult(profile, SLOT_QUOTA, { type: 'button', body: QUOTA_QUESTION_TEXT, buttons: QUOTA_BUTTONS });
}

function askAdmissionType(profile, legacyExam) {
  const buttons = legacyExam === EXAM_MHT ? MHT_ADMISSION_BUTTONS : KCET_ADMISSION_BUTTONS;
  return askResult(profile, SLOT_ADMISSION_TYPE, { type: 'button', body: ADMISSION_TYPE_QUESTION_TEXT, buttons });
}

/**
 * The rank/percentile question's own free-text reply is normally JUST a
 * bare number ("18453"), not the phrase "rank 18453" \u2014
 * `flowV2SlotExtractor.extractRank`/`extractPercentile` deliberately
 * require an explicit "rank"/"air"/"percentile" keyword (so they never
 * mistake an UNPROMPTED number elsewhere in free text for one of these
 * fields \u2014 see those functions' own doc comments). That safety
 * requirement does not apply once we have JUST asked the specific
 * question ourselves and are looking at its direct reply \u2014 these two
 * narrow, stage-scoped fallbacks close that gap, the same precedent
 * `b3Constraints.js`'s own tap recognizers already established for
 * exactly this "the shared extractor is right in general, wrong for our
 * own pending question's expected reply shape" situation.
 */
function extractBareRank(text) {
  const t = String(text || '').trim().replace(/,/g, '');
  const match = t.match(/^(\d{1,7})$/);
  return match ? parseInt(match[1], 10) : null;
}

function extractBarePercentile(text) {
  const t = String(text || '').trim().replace(/%$/, '');
  const match = t.match(/^(\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return value >= 0 && value <= 100 ? value : null;
}

/**
 * KCET/MHT-CET admission-type tap recognizer \u2014 node-local, NOT part of
 * the shared `extractFlowV2Slots` (see module doc's ADMISSION TYPE
 * section for why: KCET's "General" collides with the shared extractor's
 * generic category keyword). Checked in an order that resolves the one
 * genuine internal ambiguity for MHT-CET ("other" is checked before
 * "home university", since "other than home university" itself contains
 * the substring "home university").
 * @param {string} text
 * @param {string|null} legacyExam
 * @returns {string|null}
 */
function extractR4PAdmissionTypeTap(text, legacyExam) {
  const t = String(text || '').toLowerCase();
  if (legacyExam === EXAM_KCET) {
    if (/\bhk\b|\bhyderabad[- ]karnataka\b/.test(t)) return 'HK';
    if (/\bgeneral\b/.test(t)) return 'GENERAL';
    return null;
  }
  if (legacyExam === EXAM_MHT) {
    if (/\bother\b/.test(t)) return 'OTHER_THAN_HOME_UNIVERSITY';
    if (/\bhome university\b/.test(t)) return 'HOME_UNIVERSITY';
    if (/\bstate level\b/.test(t)) return 'STATE_LEVEL';
    return null;
  }
  return null;
}

/**
 * @param {string} legacySlot
 * @param {object} profile - the MERGED profile (already has examType if known)
 * @returns {object} standard Flow v2 node return shape
 */
function askForSlot(profile, legacySlot) {
  switch (legacySlot) {
    case SLOT_EXAM:
      return askExam(profile);
    case SLOT_RANK:
      return askRank(profile);
    case SLOT_PERCENTILE:
      return askPercentile(profile);
    case SLOT_CATEGORY:
      return askCategory(profile);
    case SLOT_GENDER:
      return askGender(profile);
    case SLOT_QUOTA:
      return askQuota(profile);
    case SLOT_REGION:
      return askRegion(profile);
    case SLOT_ADMISSION_TYPE:
      return askAdmissionType(profile, resolveLegacyExam(profile.examType));
    default:
      // Indicates collegePredictorSlots.js's slot vocabulary grew a new
      // slot name this adapter doesn't know about yet \u2014 a real bug to
      // fix here, not a normal runtime input problem, so this throws
      // rather than silently asking nothing.
      throw new Error(
        `r4pPredictor.askForSlot: unrecognized slot "${legacySlot}" from slotOrderForExam() \u2014 SLOT_PROFILE_FIELD/askForSlot need a new case.`
      );
  }
}

function slotCompleteResult(mergedProfile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: R4P_AWAITING_PREDICTION_STAGE, profile: mergedProfile, r4pPendingSlot: null },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * Core Stage 2 reply handler \u2014 runs while `stage === R4P_SLOT_STAGE`.
 * Always runs the generic extractor first (so an over-answer that
 * mentions MULTIPLE slots at once, e.g. "TS EAMCET rank 18453 OC Male",
 * fills all of them from a single message, matching every other Flow v2
 * beat's over-answer discipline) and only THEN applies the narrow,
 * pending-slot-scoped fallbacks (bare rank/percentile, admission-type
 * tap) that the shared extractor deliberately does not cover.
 * @param {{ flowV2?: { profile?: object, r4pPendingSlot?: string|null } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function processSlotReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const pendingSlot = ctx?.flowV2?.r4pPendingSlot || null;
  const patch = extractFlowV2Slots(text, profile);

  if (pendingSlot === SLOT_RANK && patch.rank == null) {
    const bare = extractBareRank(text);
    if (bare != null) patch.rank = bare;
  }
  if (pendingSlot === SLOT_PERCENTILE && patch.percentile == null) {
    const bare = extractBarePercentile(text);
    if (bare != null) patch.percentile = bare;
  }
  if (pendingSlot === SLOT_ADMISSION_TYPE) {
    const legacyExam = resolveLegacyExam(profile.examType);
    const tapped = extractR4PAdmissionTypeTap(text, legacyExam);
    if (tapped) {
      patch.admissionType = tapped;
      // "General" is simultaneously KCET's own admission-type option AND
      // the shared extractor's generic category keyword \u2014 while
      // ANSWERING the admission-type question specifically, a bare
      // "general" match must not silently pre-fill profile.category
      // before category is actually asked (KCET's own slot order asks
      // admission_type strictly before category). A message that also
      // names a genuinely different category value (e.g. "General
      // admission, OC category") is unaffected \u2014 only this exact
      // ambiguous-word collision is suppressed.
      if (tapped === 'GENERAL' && patch.category === 'GENERAL') {
        delete patch.category;
      }
    }
  }

  const mergedProfile = mergeFlowV2Profile(profile, patch);

  // ORDERING GUARANTEE \u2014 see module doc's \u2461 SLOT FILLING section. Must
  // run on every merge, unconditionally, before missing-slot computation.
  if (isBlockedDemographic(mergedProfile)) {
    return blockedDemographicReply(mergedProfile);
  }

  const missing = getR4PMissingSlots(mergedProfile);
  if (missing.length === 0) {
    return slotCompleteResult(mergedProfile);
  }

  // "Never re-ask a known slot" falls out of this by construction: if
  // nothing in this reply resolved `pendingSlot`, it is still first in
  // `missing` (slot order is fixed per exam), so the SAME question is
  // re-asked \u2014 never silently defaulted, never skipped forward.
  return askForSlot(mergedProfile, missing[0]);
}

/**
 * R4-P entry point. STAGE 1's blocked-demographic gate is UNCHANGED and
 * still THE FIRST CHECK \u2014 nothing above it reads any other profile
 * field. STAGE 2 replaces Stage 1's "not yet implemented" stub for the
 * non-blocked path with real slot-filling: asks the next missing slot
 * for whatever exam (if any) is already known, or transitions to the
 * Stage 3 placeholder if every slot the student's exam needs is already
 * known (e.g. via an earlier beat's over-answer).
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleR4PEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // THE FIRST CHECK. Nothing above this line reads any other profile
  // field, builds any slot question, or does anything else \u2014 see module
  // doc's \u2460 section for why this ordering is load-bearing.
  if (isBlockedDemographic(profile)) {
    return blockedDemographicReply(profile);
  }

  const missing = getR4PMissingSlots(profile);
  if (missing.length === 0) {
    return slotCompleteResult(profile);
  }
  return askForSlot(profile, missing[0]);
}

/**
 * R4-P reply router. STAGE 1's `R4P_BLOCKED_STAGE` sub-replies and STAGE
 * 2's `R4P_SLOT_STAGE` are the only stages with a real handler here.
 * `R4P_AWAITING_PREDICTION_STAGE` is a documented Stage-3 placeholder
 * with NO handler here by design \u2014 see that constant's own doc comment.
 * @param {{ flowV2?: { stage?: string|null, profile?: object, r4pPendingSlot?: string|null } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleR4PReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const stage = ctx?.flowV2?.stage || null;
  const t = String(text || '');

  if (stage === R4P_BLOCKED_STAGE) {
    if (CHECKLIST_PATTERN.test(t)) {
      return checklistReply(profile);
    }
    // Deliberately NO "Connect me" branch \u2014 see module doc's "NODE 0
    // HANDOFF, NOT A DUPLICATE PATH" section. In production this stage
    // is only ever reached for a message that already failed
    // `detectOverrideIntent()` at the dispatcher level (Node 0 always
    // intercepts "Connect me" first) \u2014 so any text that reaches this
    // point, INCLUDING a literal "Connect me" sent to this function
    // directly (bypassing the dispatcher, which no real caller does),
    // is treated as an unrecognized reply and gets the same non-silent
    // re-offer, never a fabricated hand-off of its own.
    return blockedDemographicReply(profile);
  }

  if (stage === R4P_SLOT_STAGE) {
    return processSlotReply(ctx, text);
  }

  throw new Error(
    `r4pPredictor.handleR4PReply: no handler yet for stage "${stage}" \u2014 only R4P_BLOCKED_STAGE (Stage 1) and R4P_SLOT_STAGE (Stage 2) are implemented so far. "${R4P_AWAITING_PREDICTION_STAGE}" is a Stage-3 placeholder with no handler here by design \u2014 the dispatcher's own safeFallbackReply covers it once this node is wired in (see test/flowV2R4PPredictor.test.js).`
  );
}

module.exports = {
  handleR4PEntry,
  handleR4PReply,
  isBlockedDemographic,
  resolveApTsCategoryId,
  R4P_BLOCKED_STAGE,
  BLOCKED_REPLY_TEXT,
  BLOCKED_BUTTONS,
  RECONNECT_BUTTONS,
  RECONNECT_PROMPT_TEXT,
  CHECKLIST_TEXT,
  // Stage 2 exports \u2014 for focused unit testing.
  R4P_SLOT_STAGE,
  R4P_AWAITING_PREDICTION_STAGE,
  resolveLegacyExam,
  getR4PSlotOrder,
  getR4PMissingSlots,
  extractBareRank,
  extractBarePercentile,
  extractR4PAdmissionTypeTap,
  EXAM_ROWS,
  CATEGORY_ROWS,
  GENDER_BUTTONS,
  REGION_BUTTONS,
  QUOTA_BUTTONS,
  KCET_ADMISSION_BUTTONS,
  MHT_ADMISSION_BUTTONS,
};
