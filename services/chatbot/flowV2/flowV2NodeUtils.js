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
 * Parks at `stage: 'b3_awaiting_entry'` — interim Phase 1 legacy constraints
 * (V3 B6.5 will replace this placement in Phase 2).
 *
 * @param {object} mergedProfile
 * @param {string|null} [ackLine]
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

/**
 * Parks at V3 B4 PRIORITY entry (implemented by b1Goal.js handleB1Entry).
 */
function advanceToB4(mergedProfile, ackLine = null) {
  return {
    replyText: ackLine || null,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: 'b4_awaiting_entry', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * Parks at V3 B5 CHECKLIST entry.
 */
function advanceToB5Checklist(mergedProfile, ackLine = null) {
  return {
    replyText: ackLine || null,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: 'b5_checklist_awaiting_entry', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  withMergedProfile,
  combineNodeResults,
  advanceToB3,
  advanceToB4,
  advanceToB5Checklist,
};
