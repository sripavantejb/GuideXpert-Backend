'use strict';

/**
 * Flow v2 — B1 · Goal (first real beat after Greeting).
 *
 * `handleB1Entry` fires when `context.flowV2.stage` transitions into B1
 * (from Greeting's `'greeting_captured_pending_b1'`, or via a skip-chain
 * from an R3/R4 over-answer that already populated `goalPriority`).
 * `handleB1Reply` fires while `stage === 'b1_awaiting_reply'`.
 *
 * SKIP CONTRACT: `handleB1Entry` checks `profile.goalPriority` FIRST. If
 * already non-empty (an R3 over-answer, or Node 0's backfill question),
 * the B1 question is never sent — control falls straight into
 * `handleB2Entry` within the SAME turn (see `flowV2NodeUtils.js`), which
 * runs its OWN skip-check independently. This is what makes "an R3
 * over-answerer must skip B2 entirely" work: B1Reply's own success path
 * merges the FULL extracted patch (not just `goalPriority`) before
 * advancing, so if the same message also answered B2's question,
 * `handleB2Entry`'s skip-check sees `branchInterest` already filled too
 * and cascades straight past it on its own.
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, combineNodeResults } = require('../flowV2NodeUtils');
const { handleB2Entry } = require('./b2Branch');

const B1_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_b1_placements', title: 'Strong placements' }),
  Object.freeze({ id: 'flowv2_b1_ai_future_tech', title: 'AI & future tech' }),
  Object.freeze({ id: 'flowv2_b1_affordable_fees', title: 'Affordable fees' }),
  Object.freeze({ id: 'flowv2_b1_higher_studies', title: 'Higher studies later' }),
  Object.freeze({ id: 'flowv2_b1_startup', title: 'Startup / entrepreneurship' }),
  Object.freeze({ id: 'flowv2_b1_not_sure', title: 'Not sure yet' }),
]);
const B1_LIST_SECTION_TITLE = 'What matters most?';
const B1_LIST_BUTTON_TEXT = 'Select';

const B1_QUESTION_TAIL = 'What matters most to you right now?';
const B1_REASK_BODY = "No worries — take your time. Pick whichever fits best for now:";

/**
 * Short acknowledgment tied to the student's already-known qualification
 * (spec gives this as an "e.g." template, not a fixed verbatim string —
 * this mapping is a judgment call covering the known qualification values
 * from Greeting's own QUALIFICATION_ROWS / extractQualification output).
 */
function qualificationAckLine(qualification) {
  const q = String(qualification || '').toLowerCase();
  if (q.includes('(pcm)') || q.includes('(mpc)')) return 'Perfect \u2014 MPC keeps engineering and tech wide open for you.';
  if (q.includes('(pcb)') || q.includes('(bipc)')) return 'Got it.';
  if (q.includes('(commerce)') || q.includes('mec') || q.includes('cec')) {
    return 'Got it \u2014 commerce opens up business, finance and design routes.';
  }
  if (q === 'diploma') return 'Good \u2014 and lateral entry gives you a real head start.';
  if (q === 'drop year' || q.includes('dropper') || q.includes('gap year')) {
    return 'Good \u2014 and a drop year works more often than people think.';
  }
  if (q === 'degree' || q.includes('already in college') || q.includes('b.tech') || q.includes('graduation')) {
    return 'Understood.';
  }
  if (q === '11th studying') return "Good timing \u2014 you've got room to prepare properly.";
  if (q === '10th completed') return "Good \u2014 plenty of runway to plan this properly.";
  return 'Thanks for sharing that.';
}

function buildB1ListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: B1_LIST_BUTTON_TEXT,
    sections: [{ title: B1_LIST_SECTION_TITLE, rows: B1_ROWS }],
  };
}

function isGoalPriorityFilled(goalPriority) {
  return Array.isArray(goalPriority) && goalPriority.length > 0;
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB1Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // SKIP CHECK FIRST — never send the B1 question if goalPriority is
  // already known (R3 over-answer, or Node 0's backfill question).
  if (isGoalPriorityFilled(profile.goalPriority)) {
    return handleB2Entry(ctx);
  }

  const body = `${qualificationAckLine(profile.qualification)} ${B1_QUESTION_TAIL}`;
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB1ListInteractive(body),
    // `profile` is included even though this branch doesn't modify it —
    // handleB1Entry can be reached via a chain (e.g. Node 0's own future
    // backfill hand-off) with a profile already updated by the caller,
    // and this contextPatch is what propagates that merge forward.
    contextPatch: { stage: 'b1_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/** One short line per matched priority label, for the ack sentence. Not
 * exhaustive spec copy (only "placements" was given verbatim as an
 * example) — a documented judgment call covering every label this
 * extractor can currently produce. */
const GOAL_ACK_LEAD = Object.freeze({
  placement: "Noted \u2014 placements first. That genuinely changes what I'd recommend, so thanks for being clear.",
  ai_future_tech: "Good instinct \u2014 that's where the sharpest students are heading right now.",
  affordable: 'Completely fair \u2014 and there are genuinely good options in that range.',
  fee: 'Completely fair \u2014 and there are genuinely good options in that range.',
  higher_studies: 'Useful to know \u2014 that changes which colleges actually make sense.',
  startup: "Good \u2014 that's a different filter entirely, and a useful one.",
  entrepreneurship: "Good \u2014 that's a different filter entirely, and a useful one.",
});

function goalPriorityAckLine(goalPriority) {
  return GOAL_ACK_LEAD[goalPriority[0]] || 'Noted \u2014 got it.';
}

function reAskB1(mergedProfile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB1ListInteractive(B1_REASK_BODY),
    contextPatch: { stage: 'b1_awaiting_reply', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB1Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const patch = extractFlowV2Slots(text, profile);

  // "Not sure yet" (or any reply that doesn't confidently answer THIS
  // question, e.g. an R4 rank-entry message that only extracted `rank`)
  // must never push a default goalPriority value — silently keep
  // whatever ELSE was extracted (so an R4 rank-entry student's data isn't
  // thrown away) and gently re-ask, mirroring Greeting's own
  // `reAskShortened()` shape rather than inventing a new one.
  if (!isGoalPriorityFilled(patch.goalPriority)) {
    const mergedProfile = mergeFlowV2Profile(profile, patch);
    return reAskB1(mergedProfile);
  }

  const mergedProfile = mergeFlowV2Profile(profile, patch);
  const ackLine = goalPriorityAckLine(patch.goalPriority);
  const nextResult = handleB2Entry(withMergedProfile(ctx, mergedProfile));
  return combineNodeResults([ackLine], nextResult);
}

module.exports = {
  handleB1Entry,
  handleB1Reply,
  // exported for focused unit testing
  qualificationAckLine,
  goalPriorityAckLine,
  buildB1ListInteractive,
  B1_ROWS,
  B1_LIST_SECTION_TITLE,
  B1_LIST_BUTTON_TEXT,
  B1_QUESTION_TAIL,
  B1_REASK_BODY,
};
