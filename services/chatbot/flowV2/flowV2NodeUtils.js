'use strict';

/**
 * Flow V3 — shared advance parks for the B1–B10 spine.
 */

function withMergedProfile(ctx, mergedProfile) {
  return { ...(ctx || {}), flowV2: { ...((ctx && ctx.flowV2) || {}), profile: mergedProfile } };
}

function combineNodeResults(prefixReplyParts, nextResult) {
  const nextText = nextResult.replyText ? [nextResult.replyText] : [];
  const nextParts = nextResult.replyParts || [];
  return {
    ...nextResult,
    replyText: null,
    replyParts: [...(prefixReplyParts || []), ...nextText, ...nextParts],
  };
}

function park(stage, mergedProfile, ackLine = null) {
  return {
    replyText: ackLine || null,
    replyParts: null,
    interactive: null,
    contextPatch: { stage, profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/** @deprecated name — V3 B6.5 constraints (was early B3). */
function advanceToB3(mergedProfile, ackLine = null) {
  return park('b65_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB4(mergedProfile, ackLine = null) {
  return park('b4_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB5Checklist(mergedProfile, ackLine = null) {
  return park('b5_checklist_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB65(mergedProfile, ackLine = null) {
  return park('b65_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB7TwoModels(mergedProfile, ackLine = null) {
  return park('b7_two_models_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB8(mergedProfile, ackLine = null) {
  return park('b8_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB9(mergedProfile, ackLine = null) {
  return park('b9_awaiting_entry', mergedProfile, ackLine);
}

function advanceToB10(mergedProfile, ackLine = null) {
  return park('b10_awaiting_entry', mergedProfile, ackLine);
}

module.exports = {
  withMergedProfile,
  combineNodeResults,
  advanceToB3,
  advanceToB4,
  advanceToB5Checklist,
  advanceToB65,
  advanceToB7TwoModels,
  advanceToB8,
  advanceToB9,
  advanceToB10,
};
