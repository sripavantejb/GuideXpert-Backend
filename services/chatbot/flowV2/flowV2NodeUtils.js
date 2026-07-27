'use strict';

/**
 * Flow v2 — small shared helpers for node files that need to chain
 * straight into another beat's entry function WITHIN THE SAME TURN (e.g.
 * a skip-check falling through to the next beat, or an ack immediately
 * followed by the next question) rather than waiting for a separate
 * inbound message.
 *
 * This is the same "prefix line(s) + nested result" shape
 * `flowV2Dispatcher.js` already uses for R7 Tier-1 (empathetic prefix +
 * whatever the stage fallthrough returns) — pulled out here so B1/B2/the
 * core-engineering fork can reuse the identical pattern instead of each
 * reimplementing it slightly differently.
 */

/**
 * @param {object} ctx
 * @param {object} mergedProfile - a profile object (typically the output
 *   of mergeFlowV2Profile) to hand to the next node function
 * @returns {object} a new ctx with flowV2.profile replaced (ctx itself is
 *   not mutated)
 */
function withMergedProfile(ctx, mergedProfile) {
  return { ...(ctx || {}), flowV2: { ...((ctx && ctx.flowV2) || {}), profile: mergedProfile } };
}

/**
 * Prepends `prefixReplyParts` (plain strings, one per message bubble) in
 * front of whatever `nextResult` (the nested node call's own return value)
 * already carries, preserving its `interactive` / `contextPatch` /
 * `nextState` / `intent` / `pendingSideEffect` untouched.
 *
 * @param {string[]} prefixReplyParts
 * @param {object} nextResult - standard Flow v2 node return shape
 * @returns {object} standard Flow v2 node return shape
 */
function combineNodeResults(prefixReplyParts, nextResult) {
  const nextText = nextResult.replyText ? [nextResult.replyText] : [];
  const nextParts = nextResult.replyParts || [];
  return {
    ...nextResult,
    replyText: null,
    replyParts: [...(prefixReplyParts || []), ...nextText, ...nextParts],
  };
}

/**
 * Sets `stage: 'b3_awaiting_entry'`, matching the established precedent
 * from Node 0 / Greeting (`'greeting_captured_pending_b1'` -> B1Entry,
 * `'node0_awaiting_backfill'`) of "advance-to-next-beat" callers setting
 * an entry stage and WAITING for the next turn, rather than chaining
 * straight into the next beat's entry function inline — B3 (Phase 5) is
 * now wired to this stage in `flowV2Dispatcher.js`'s `runStageFallthrough`.
 * Kept as a shared helper (rather than duplicated) because B2, the
 * core-engineering fork, AND the fork's honest-exit sub-flow all need to
 * "advance to B3" — keeping it in this dependency-free leaf module avoids
 * a circular require between b2Branch.js <-> b2CoreFork.js <->
 * b2CoreForkExit.js.
 *
 * @param {object} mergedProfile
 * @param {string|null} [ackLine] - omit (or pass null) for a silent,
 *   purely structural advance (e.g. a pre-filled-slot skip check) with no
 *   visible reply.
 * @returns {object} standard Flow v2 node return shape
 */
function advanceToB3(mergedProfile, ackLine = null) {
  return {
    replyText: ackLine || null,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: 'b3_awaiting_entry', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  withMergedProfile,
  combineNodeResults,
  advanceToB3,
};
