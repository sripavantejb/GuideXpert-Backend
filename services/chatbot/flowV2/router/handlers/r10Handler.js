'use strict';

/**
 * Flow v2 — R10 handler (ambiguous / generalized guess-then-confirm).
 *
 * Sub-cases (from classifyReply's `subCase`): 'bare_inter', 'bare_year',
 * 'pcm', 'pcb', 'typo_guess'.
 *
 * PCM/PCB and typo_guess resolve directly to a final qualification value,
 * so they reuse Greeting's own `acceptQualification` (additively exported
 * from greeting.js) to advance `context.flowV2.stage` correctly — this
 * avoids a double-ask bug where the profile has the value but the stage
 * still expects a qualification answer.
 *
 * bare_inter/bare_year are multi-step clarifying questions. TODO(Phase 4):
 * once B1 exists and stage-transition ownership outside Greeting is
 * clear, complete the year+stream combination into a single resolved
 * qualification value via `pendingAmbiguousResolution`. This phase only
 * asks the first clarifying question and records the scratch state —
 * the follow-up tap currently falls through as R1 (unchanged fallthrough,
 * per spec) rather than being fully resolved here.
 *
 * "SILENT" save (PCM/PCB, per spec guard rail) means: no interactive
 * Yes/No confirmation prompt is shown — NOT that zero reply is sent.
 * `acceptQualification`'s own short acknowledgment ("Got it — ...") is
 * used, since it is an acknowledgment, not a "right?" confirmation
 * question.
 */

const { acceptQualification, GUESS_CONFIRM_YES, GUESS_CONFIRM_NO } = require('../../nodes/greeting');

const BARE_INTER_TEXT = 'Inter — first year or second year?';
const BARE_INTER_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r10_inter_1st', title: '1st year' }),
  Object.freeze({ id: 'flowv2_r10_inter_2nd', title: '2nd year' }),
  Object.freeze({ id: 'flowv2_r10_inter_finished', title: 'Just finished' }),
]);

const BARE_YEAR_TEXT = 'Second year of\u2026?';
const BARE_YEAR_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r10_year_inter', title: 'Inter / 12th' }),
  Object.freeze({ id: 'flowv2_r10_year_diploma', title: 'Diploma' }),
  Object.freeze({ id: 'flowv2_r10_year_btech', title: 'B.Tech' }),
]);

const PCM_QUALIFICATION = 'Class 12 (MPC)';
const PCB_QUALIFICATION = 'Class 12 (BiPC)';

function buttonShape(body, buttons, contextPatch = {}) {
  return {
    replyText: null,
    replyParts: null,
    interactive: { type: 'button', body, buttons },
    contextPatch,
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {object} ctx
 * @param {string} text
 * @param {{ subCase?: string, guess?: string }} [classification]
 * @returns {object} standard Flow v2 node return shape
 */
function handleR10(ctx, text, classification = {}) {
  const { subCase, guess } = classification;

  if (subCase === 'pcm') {
    return acceptQualification(ctx, PCM_QUALIFICATION);
  }
  if (subCase === 'pcb') {
    return acceptQualification(ctx, PCB_QUALIFICATION);
  }

  if (subCase === 'bare_inter') {
    return buttonShape(BARE_INTER_TEXT, BARE_INTER_BUTTONS, {
      pendingAmbiguousResolution: { slot: 'qualification', partial: 'inter' },
    });
  }

  if (subCase === 'bare_year') {
    return buttonShape(BARE_YEAR_TEXT, BARE_YEAR_BUTTONS, {
      pendingAmbiguousResolution: { slot: 'qualification', partial: '2nd_year' },
    });
  }

  if (subCase === 'typo_guess' && guess) {
    // Rides on Greeting's OWN pendingQualificationGuess mechanism (same
    // field name, not a new one) — when stage is 'greeting_awaiting_reply'
    // and the student replies "yes", handleGreetingReply already checks
    // this field and calls acceptQualification itself. No change to
    // greeting.js's reply-handling logic needed.
    return buttonShape(`${guess}, right?`, [GUESS_CONFIRM_YES, GUESS_CONFIRM_NO], {
      pendingQualificationGuess: guess,
    });
  }

  // Should not be reached — classifyReply only returns R10 with one of
  // the sub-cases above. Defensive fallback: re-ask nothing, no-op.
  return {
    replyText: null,
    replyParts: null,
    interactive: null,
    contextPatch: {},
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleR10,
  BARE_INTER_TEXT,
  BARE_INTER_BUTTONS,
  BARE_YEAR_TEXT,
  BARE_YEAR_BUTTONS,
  PCM_QUALIFICATION,
  PCB_QUALIFICATION,
};
