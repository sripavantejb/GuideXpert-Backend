'use strict';

/**
 * Flow v2 — B2 · Branch (including the B2.2 core-engineering fork route-in).
 *
 * `handleB2Entry` fires when `context.flowV2.stage` transitions into B2
 * (from B1's success path, or via a skip-chain from an R3/R4 over-answer
 * that already populated `branchInterest`). `handleB2Reply` fires while
 * `stage === 'b2_awaiting_reply'`.
 *
 * SKIP CONTRACT: `handleB2Entry` checks `profile.coreBridgeClosed` FIRST
 * (structural guarantee — see module docstring in b2CoreForkExit.js), then
 * `profile.branchInterest`. If branch is already known AND it's a core-
 * engineering field, control chains straight into `handleCoreForkEntry`
 * (the fork's OWN nudge must still run even on a pre-filled branch — it's
 * about the nudge, not the question). If branch is known and is NOT core
 * engineering, control silently advances to B3 (no B2 question, no ack —
 * a purely structural skip, mirroring how a pre-filled slot is never
 * re-asked anywhere else in Flow v2).
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, advanceToB3 } = require('../flowV2NodeUtils');
const { handleR11 } = require('../router/handlers/r11Handler');
const { handleCoreForkEntry } = require('./b2CoreFork');

const B2_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_b2_coding_ai', title: 'Coding / software / AI' }),
  Object.freeze({ id: 'flowv2_b2_core_engineering', title: 'Core engineering (mech, civil, ECE)' }),
  Object.freeze({ id: 'flowv2_b2_design_product', title: 'Design / product' }),
  Object.freeze({ id: 'flowv2_b2_business', title: 'Business / management' }),
  Object.freeze({ id: 'flowv2_b2_data_analytics', title: 'Data / analytics' }),
  Object.freeze({ id: 'flowv2_b2_not_sure', title: 'Not sure yet' }),
]);
const B2_LIST_SECTION_TITLE = 'Pick a field';
const B2_LIST_BUTTON_TEXT = 'Select';

const B2_QUESTION = 'Which field pulls you?';
const B2_REASK_BODY = "No worries \u2014 take your time. Pick whichever fits best for now:";

/**
 * No catalog/business-branch flag/constant exists anywhere in this
 * codebase today (checked old V2 and Flow v2 — confirmed absent, not
 * guessed) — see this phase's output notes. Treated as "no business
 * catalog available" unconditionally for now, so both a direct list tap
 * AND a pre-filled `branchInterest` extracted elsewhere consistently
 * redirect to R11's existing out-of-scope handler rather than duplicating
 * that copy here.
 */
const BUSINESS_BRANCH_VALUES = Object.freeze(['business/commerce', 'business', 'mba', 'bba']);
function isBusinessBranch(branchInterest) {
  if (!branchInterest) return false;
  return BUSINESS_BRANCH_VALUES.includes(String(branchInterest).toLowerCase());
}

/** 'core' (the exit sub-flow's own normalized value) is included so a
 * defensively-reset branchInterest of literally 'core' is still
 * recognized as core-engineering, even though coreBridgeClosed already
 * blocks re-entry before this check ever runs in practice. */
const CORE_ENGINEERING_BRANCH_VALUES = Object.freeze(['mechanical', 'civil', 'ece', 'eee', 'core']);
function isCoreEngineeringBranch(branchInterest) {
  if (!branchInterest) return false;
  return CORE_ENGINEERING_BRANCH_VALUES.includes(String(branchInterest).toLowerCase());
}

function isBranchFilled(branchInterest) {
  return typeof branchInterest === 'string' && branchInterest.length > 0;
}

/** `handleR11()` itself returns `contextPatch: {}` (by design — the
 * router-level R11 bucket never needs to merge anything). Reached from
 * HERE, though, `mergedProfile` may carry extraction this same message
 * produced (e.g. a co-mentioned budget/city alongside "MBA") that would
 * otherwise be silently dropped — this thin wrapper carries it forward. */
function outOfScopeWithProfile(mergedProfile) {
  const result = handleR11();
  return { ...result, contextPatch: { ...result.contextPatch, profile: mergedProfile } };
}

function buildB2ListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: B2_LIST_BUTTON_TEXT,
    sections: [{ title: B2_LIST_SECTION_TITLE, rows: B2_ROWS }],
  };
}

/** Not exhaustive spec copy (no verbatim ack was given for B2's own
 * non-core options) — a documented judgment call, one short line per
 * branch value this extractor can currently produce. */
function branchAckLine(branchInterest) {
  const b = String(branchInterest || '').toLowerCase();
  if (b === 'cse_ai' || b === 'cse' || b === 'it') return "Solid \u2014 and it's the most flexible base you can pick right now.";
  if (b === 'design') return 'Good \u2014 design plus tech is a genuinely strong combination right now.';
  if (b === 'data_analytics') return 'Good pick \u2014 that sits right next to AI.';
  return 'Got it, noted.';
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB2Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // Guard rail: once the fork's honest-exit sub-flow has closed this
  // student out, it is structurally impossible to re-enter the fork here
  // again — checked BEFORE the branchInterest pre-fill check below, even
  // if branchInterest somehow reads back as a core value.
  if (profile.coreBridgeClosed === true) {
    return advanceToB3(profile, null);
  }

  if (isBranchFilled(profile.branchInterest)) {
    if (isCoreEngineeringBranch(profile.branchInterest)) {
      return handleCoreForkEntry(ctx);
    }
    if (isBusinessBranch(profile.branchInterest)) {
      return outOfScopeWithProfile(profile);
    }
    return advanceToB3(profile, null);
  }

  return {
    replyText: null,
    replyParts: null,
    interactive: buildB2ListInteractive(B2_QUESTION),
    // `profile` is included even though this branch doesn't modify it —
    // handleB2Entry can be reached via a chain (B1's success path) with a
    // profile already updated by the caller, and this contextPatch is
    // what propagates that merge forward.
    contextPatch: { stage: 'b2_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function reAskB2(mergedProfile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB2ListInteractive(B2_REASK_BODY),
    contextPatch: { stage: 'b2_awaiting_reply', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB2Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const patch = extractFlowV2Slots(text, profile);

  // "Not sure yet" (or any reply that doesn't confidently answer this
  // question) must never push a default branchInterest value — silently
  // keep whatever else was extracted and gently re-ask.
  if (!patch.branchInterest) {
    const mergedProfile = mergeFlowV2Profile(profile, patch);
    return reAskB2(mergedProfile);
  }

  const mergedProfile = mergeFlowV2Profile(profile, patch);

  if (isCoreEngineeringBranch(patch.branchInterest)) {
    // Do NOT advance to B3 directly — the fork's own nudge is the response.
    return handleCoreForkEntry(withMergedProfile(ctx, mergedProfile));
  }

  if (isBusinessBranch(patch.branchInterest)) {
    // No business catalog exists (confirmed absent, not guessed) — reuse
    // R11's existing out-of-scope handler rather than duplicating its copy.
    return outOfScopeWithProfile(mergedProfile);
  }

  return advanceToB3(mergedProfile, branchAckLine(patch.branchInterest));
}

module.exports = {
  handleB2Entry,
  handleB2Reply,
  // exported for focused unit testing / reuse
  isCoreEngineeringBranch,
  isBusinessBranch,
  branchAckLine,
  buildB2ListInteractive,
  B2_ROWS,
  B2_QUESTION,
  B2_REASK_BODY,
};
