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
 * bare_inter/bare_year are multi-step clarifying questions. They record
 * `pendingAmbiguousResolution`; Node E deterministically consumes the
 * follow-up and routes the resulting canonical qualification.
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

const PASSED_OUT_TEXT = 'Passed out of 12th, or of a diploma?';
const PASSED_OUT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r10_passed_12th', title: '12th' }),
  Object.freeze({ id: 'flowv2_r10_passed_diploma', title: 'Diploma' }),
  Object.freeze({ id: 'flowv2_r10_passed_degree', title: 'Degree' }),
]);

const PCM_QUALIFICATION = '12th Completed (PCM)';
const PCB_QUALIFICATION = '12th Completed (PCB)';

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
    return acceptQualification(ctx, PCM_QUALIFICATION, { temperature: 'warm' });
  }
  if (subCase === 'pcb') {
    return acceptQualification(ctx, PCB_QUALIFICATION, { temperature: 'warm' });
  }

  if (subCase === 'bare_inter') {
    return buttonShape(BARE_INTER_TEXT, BARE_INTER_BUTTONS, {
      stage: ctx?.flowV2?.stage || 'greeting_awaiting_qualification',
      pendingAmbiguousResolution: { slot: 'qualification', partial: 'inter' },
    });
  }

  if (subCase === 'bare_year') {
    return buttonShape(BARE_YEAR_TEXT, BARE_YEAR_BUTTONS, {
      stage: ctx?.flowV2?.stage || 'greeting_awaiting_qualification',
      pendingAmbiguousResolution: { slot: 'qualification', partial: '2nd_year' },
    });
  }

  if (subCase === 'passed_out') {
    return buttonShape(PASSED_OUT_TEXT, PASSED_OUT_BUTTONS, {
      stage: ctx?.flowV2?.stage || 'greeting_awaiting_qualification',
      pendingAmbiguousResolution: { slot: 'qualification', partial: 'passed_out' },
    });
  }

  if (subCase === 'bare_12th_pass') {
    return buttonShape('Got it — which stream?', [
      Object.freeze({ id: 'flowv2_r10_stream_pcm', title: 'MPC / PCM' }),
      Object.freeze({ id: 'flowv2_r10_stream_pcb', title: 'BiPC / PCB' }),
      Object.freeze({ id: 'flowv2_r10_stream_commerce', title: 'MEC / CEC' }),
    ], {
      stage: ctx?.flowV2?.stage || 'greeting_awaiting_qualification',
      pendingAmbiguousResolution: { slot: 'qualification', partial: 'inter_stream' },
    });
  }

  if (subCase === 'typo_guess' && guess) {
    // Rides on Node E's pendingQualificationGuess mechanism (same field
    // name, not a second scratch state). The stage is preserved so the
    // following Yes/No turn cannot accidentally restart Greeting.
    return buttonShape(`${guess}, right?`, [GUESS_CONFIRM_YES, GUESS_CONFIRM_NO], {
      stage: ctx?.flowV2?.stage || 'greeting_awaiting_qualification',
      pendingQualificationGuess: guess,
      pendingAmbiguousResolution: null,
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
  PASSED_OUT_TEXT,
  PASSED_OUT_BUTTONS,
  PCM_QUALIFICATION,
  PCB_QUALIFICATION,
};
