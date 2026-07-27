'use strict';

/**
 * Flow v2 — R6 handler (deflects).
 *
 * Copy verbatim from spec. "not interested"/"stop"/"don't message me" set
 * `profile.optedOut = true` and send EXACTLY the one line shown below — no
 * goodbye flourish beyond what's written (guard rail from spec).
 */

const { mergeFlowV2Profile } = require('../../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../../constants/careerCounsellingFlowV2Profile');

const JUST_SEND_LIST_TEXT =
  "I can — but a generic list is the thing you can already Google. Give me three taps and I'll give you one that's actually about you. Deal?";
const JUST_SEND_LIST_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r6_three_taps', title: 'Okay, 3 taps' }),
  Object.freeze({ id: 'flowv2_r6_generic_list', title: 'Just the generic list' }),
]);

const OPT_OUT_TEXT = "No problem at all — I won't message again. If you ever want a hand with college choices, just say hi. 👍";

const JUST_SEND_LIST_PATTERN = /\bjust send( me)? the list\b/i;

/**
 * @param {object} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleR6(ctx, text) {
  const t = String(text || '').toLowerCase();

  if (JUST_SEND_LIST_PATTERN.test(t)) {
    return {
      replyText: null,
      replyParts: null,
      interactive: {
        type: 'button',
        body: JUST_SEND_LIST_TEXT,
        buttons: JUST_SEND_LIST_BUTTONS,
      },
      contextPatch: {},
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  // "not interested" / "stop" / "don't message me" — opt out, no retention
  // attempt, no message beyond the single line below.
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(currentProfile, { optedOut: true });
  return {
    replyText: OPT_OUT_TEXT,
    replyParts: null,
    interactive: null,
    contextPatch: { profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleR6,
  JUST_SEND_LIST_TEXT,
  JUST_SEND_LIST_BUTTONS,
  OPT_OUT_TEXT,
};
