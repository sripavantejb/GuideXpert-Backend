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
 * Parks at `stage: 'b3_awaiting_entry'` with an optional ack line.
 *
 * Callers historically waited for the next inbound so B3 could be wired
 * later. `processFlowV2Turn` now drains this park in the SAME turn via
 * `drainAwaitingEntryStages` — students must never see an ack with no
 * follow-up question. Kept as a park (not an inline handleB3Entry call)
 * so this leaf module stays free of circular requires with b3Constraints.
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
