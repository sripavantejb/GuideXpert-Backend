'use strict';

/**
 * Flow v2 — R12 handler (hostile / testing).
 *
 * First hit: joke + buttons, `profile.hostileRedirectIssued` set true.
 * Second+ hit: short line only, no buttons, no argument/apology/escalation
 * (per spec guard rail — this is a SEPARATE, shorter message state, not
 * the same handler re-firing with the same content).
 */

const { mergeFlowV2Profile } = require('../../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../../constants/careerCounsellingFlowV2Profile');

const FIRST_REDIRECT_TEXT =
  "Ha — I'm GuideXpert's counselling bot, that's genuinely all \uD83D\uDE04 I'm useful for exactly one thing though: finding you a college that fits. Want to try me?";
const FIRST_REDIRECT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r12_go_on', title: 'Go on then' }),
  Object.freeze({ id: 'flowv2_r12_nah', title: 'Nah' }),
]);

const REPEAT_REDIRECT_TEXT = "I'm here whenever you want college help \uD83D\uDC4D";

/**
 * @param {object} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleR12(ctx) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (currentProfile.hostileRedirectIssued === true) {
    return {
      replyText: REPEAT_REDIRECT_TEXT,
      replyParts: null,
      interactive: null,
      contextPatch: {},
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const mergedProfile = mergeFlowV2Profile(currentProfile, { hostileRedirectIssued: true });
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: FIRST_REDIRECT_TEXT,
      buttons: FIRST_REDIRECT_BUTTONS,
    },
    contextPatch: { profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleR12,
  FIRST_REDIRECT_TEXT,
  FIRST_REDIRECT_BUTTONS,
  REPEAT_REDIRECT_TEXT,
};
