'use strict';

/**
 * Flow v2 — R4-P · College Predictor (real-API prediction, isolated node).
 *
 * THIS FILE IS BEING BUILT IN STAGES, REVIEWED SEPARATELY, PER EXPLICIT
 * INSTRUCTION. Do not assume anything beyond what a given stage's own
 * section below documents is actually implemented yet.
 *
 *   STAGE 1 (THIS DELIVERY): \u2460 the hard-blocked demographic case only
 *     (AP EAMCET + OC + Male) \u2014 the highest-safety-stakes piece, built
 *     and reviewed first, on its own, before any slot-filling exists.
 *   STAGE 2 (not yet built): \u2461 exam-specific slot filling.
 *   STAGE 3 (not yet built): \u2462 the real prediction API call (happy path).
 *   STAGE 4 (not yet built): \u2463 sticky results (button-based Show More /
 *     filters / Help me choose).
 *   STAGE 5 (not yet built): \u2464 the honest two-catalog bridge back into
 *     B1/B2.
 *
 * `handleR4PEntry` and `handleR4PReply` below throw an explicit, named
 * error for any input shape Stage 1 does not yet cover \u2014 deliberately,
 * so nothing downstream can mistake an unbuilt code path for a silently
 * "working" one. This is not a workaround; it is the honest state of a
 * node that is 1/5 built by design.
 *
 * ASYNC CONTRACT: this node is built against the now-async
 * `processFlowV2Turn` (see flowV2Dispatcher.js's Phase 8 conversion \u2014
 * `processFlowV2Turn` and its internal `runStageFallthrough` are both
 * `async` and `await` every stage handler uniformly). Stage 1's own
 * functions below are still fully synchronous (the blocked-case check
 * and its two replies need no network call) \u2014 the real `await` boundary
 * (Stage 3's `fetchCollegeDostColleges` call) lands in a later stage, at
 * which point `handleR4PEntry`/`handleR4PReply` become `async function`s
 * themselves. Nothing in Stage 1 needs to change for that later
 * conversion \u2014 an `async function` that never awaits anything (like
 * Stage 1's functions would remain, until Stage 3 adds a real `await`
 * inside them) behaves identically to a plain function for every caller
 * that already `await`s its result, which every caller in this codebase
 * now does.
 *
 * ISOLATION (per explicit instruction for this whole node): no existing
 * `careerCounsellingV2*.js` file is touched, and `flowV2Dispatcher.js` is
 * NOT touched by this file either \u2014 R4-P is not wired into stage-based
 * routing yet, exactly like B1-B7 were each built and unit-tested
 * standalone before being wired in. This file's exported functions are
 * called directly by its own test file, not through `processFlowV2Turn`,
 * with ONE deliberate exception: the "[Connect me] routes through Node 0"
 * test below calls `processFlowV2Turn` directly, but does so WITHOUT
 * modifying `flowV2Dispatcher.js` at all \u2014 see that test and the
 * "NODE 0 HANDOFF, NOT A DUPLICATE PATH" section below for why this is
 * possible with zero dispatcher changes.
 *
 * \u2460 BLOCKED CASE \u2014 AP EAMCET + OC + Male
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
 * `resolveApTsCategoryId`, not `resolveCategoryIdFromLabel`, on purpose:
 * `isApOcMaleBlocked` only ever applies to AP EAMCET, so this adapter
 * only ever needs to search `AP_TS_CATEGORY_OPTIONS`. It must NOT be
 * extended or reused as Stage 2's general category resolver for every
 * exam \u2014 that general mechanism already exists elsewhere in the
 * codebase and Stage 2 must reuse IT instead:
 *   - `collegePredictorSlots.js`'s `categoryOptionsForExam(ctx)` picks
 *     the correct per-exam options table (AP_TS_CATEGORY_OPTIONS /
 *     TNEA_CATEGORY_OPTIONS / KCET_CATEGORY_OPTIONS /
 *     KEAM_CATEGORY_OPTIONS / WBJEE_CATEGORY_OPTIONS /
 *     JEE_CATEGORY_OPTIONS / MHT's admission-type-dependent options).
 *   - `collegePredictorSlotExtractor.js`'s `parseCategoryFromText` /
 *     `matchCategoryOptionGeneric` already resolve free text into
 *     `{categoryLabel, categoryN, baseCategory}` across every one of
 *     those exams (menu-digit, entity-normalizer, and fuzzy/compact-
 *     token matching).
 * Confirmed during a Stage-1/Stage-2 checkpoint review, before any
 * Stage-2 code was written, specifically to avoid a second, divergent
 * implementation of the same category-resolution logic appearing
 * mid-Stage-2.
 *
 * The blocked check is the LITERAL FIRST statement executed in
 * `handleR4PEntry` \u2014 before any other profile field is even read \u2014 so
 * it is structurally impossible for a slot-filling question to be
 * generated first, now or in any later stage that extends this function.
 * `test/flowV2R4PPredictor.test.js` proves this behaviorally: every
 * shape of an AP-OC-male profile, no matter how sparse or how the rest
 * of the profile looks, returns the blocked reply and NEVER reaches (or
 * throws) the "not yet implemented" stub Stage 1 leaves for the
 * non-blocked path.
 *
 * NODE 0 HANDOFF, NOT A DUPLICATE PATH \u2014 [Connect me]:
 * "connect me" is LITERALLY one of `node0Override.js`'s own
 * `OVERRIDE_PATTERNS` (`\\bconnect me\\b`). `flowV2Dispatcher.js`'s Node 0
 * pre-empt runs `detectOverrideIntent(text)` on EVERY inbound message,
 * before ANY stage-based routing, for every stage except `b7_*`
 * (B7's own deliberate, narrow exemption \u2014 see Phase 7). R4-P's blocked
 * stage is NOT added to that exemption, on purpose: unlike B7 (which
 * needed its OWN "Book my session" button to survive Node 0's pre-empt
 * so B7's booking flow could run), R4-P's [Connect me] button WANTS the
 * exact behavior Node 0 already provides \u2014 sending the real booking
 * link and handing the student to a human path. Routing it there is the
 * correct behavior, not a bug to route around. Consequently:
 *   - `handleR4PReply` below has NO branch that recognizes "Connect me"
 *     at all \u2014 by design, not by omission (see the comment at that
 *     branch). Building one would either be dead code (Node 0 always
 *     intercepts first once this node is eventually wired into the
 *     dispatcher) or, worse, a second, divergent handoff path.
 *   - Because this requires ZERO changes to `flowV2Dispatcher.js`, it can
 *     be proven TODAY even though R4-P is not wired in yet: construct a
 *     ctx with a plausible R4-P stage string the dispatcher does not yet
 *     recognize, send "Connect me", and observe that
 *     `processFlowV2Turn` \u2014 completely unmodified \u2014 already produces
 *     Node 0's exact real response, because its Node 0 pre-empt fires for
 *     any non-`b7_*` stage regardless of whether that stage has a real
 *     handler yet. See `test/flowV2R4PPredictor.test.js`.
 *   - `'Connect me'` is added to `KNOWN_MITIGATED_COLLISION_TITLES` in
 *     `test/flowV2Node0Override.test.js`'s collision-invariant suite
 *     (Phase 7) \u2014 it is a REAL, EXPECTED collision with
 *     `OVERRIDE_PATTERNS`, deliberately left unmitigated at the
 *     dispatcher level because the "collision" IS the intended routing,
 *     not a bug. See that allowlist entry's own comment for the full
 *     reasoning (distinct from B7's "Book my session" entry, which
 *     documents a stage-exemption FIX rather than an intentional
 *     pass-through).
 */

const { isApOcMaleBlocked, AP_TS_CATEGORY_OPTIONS, EXAM_AP } = require('../../whatsappCollegePredictor/apTs');
const { mapById } = require('../../../../constants/whatsappCollegePredictor');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');

// ---------------------------------------------------------------------------
// \u2460 Blocked case \u2014 copy verbatim per task spec.
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

/**
 * R4-P entry point. STAGE 1: only the blocked-demographic gate is real;
 * everything else throws an explicit, named "not yet built" error \u2014 see
 * module doc for why that is the correct behavior for an intentionally
 * partial node, not a bug.
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

  throw new Error(
    'r4pPredictor.handleR4PEntry: slot-filling (Stage 2 of this node\u2019s staged build) is not implemented yet \u2014 only the \u2460 blocked-demographic case (Stage 1) exists so far. This profile correctly did not match the blocked case; there is deliberately nothing built yet for it to fall through to.'
  );
}

/**
 * R4-P reply router. STAGE 1: only `R4P_BLOCKED_STAGE`'s own two
 * sub-replies exist. See module doc for why there is no "Connect me"
 * branch here.
 * @param {{ flowV2?: { stage?: string|null, profile?: object } }} ctx
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

  throw new Error(
    `r4pPredictor.handleR4PReply: no handler yet for stage "${stage}" \u2014 only R4P_BLOCKED_STAGE (Stage 1 of this node\u2019s staged build) is implemented so far.`
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
};
