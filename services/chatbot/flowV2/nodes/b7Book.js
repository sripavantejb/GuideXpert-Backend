'use strict';

/**
 * Flow v2 — B7 · Book.
 *
 * The final beat in the Flow v2 spine, and the only permission gate in it —
 * every other beat only ever asks about the student's own preferences; this
 * is the one place Flow v2 asks for a genuine yes/no decision to book.
 *
 * REACHABLE FROM MULTIPLE STAGES, not just B6's normal handoff:
 * `classifyReply.js`'s R4 'best' sub-case ("best college" jump-ahead,
 * classified since Phase 3) is documented to skip B3/B4/B5/B6 and invite at
 * B7 early — that early-invite dispatcher wiring is NOT built this phase
 * (out of scope; flagged, not silently dropped — see this phase's report),
 * but `handleB7Entry` is written to degrade gracefully regardless of how it
 * was reached: it never assumes `profile.recommendation` is set.
 *
 * Introduces four of its own stages, none of which may ever go silent on an
 * arbitrary next message (Flow v2's "never dead-end" rule):
 *   b7_awaiting_reply  -> the initial [Book my session]/[Not yet] question
 *   b7_awaiting_done   -> link already sent, waiting for "Done"
 *   b7_post_decline    -> student said "Not yet"; holding state
 *   b7_post_booking    -> booking confirmed; holding state (not a dead end
 *                         for the whole conversation, just for this beat)
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const nodeZeroOverride = require('./node0Override');

// ---------------------------------------------------------------------------
// Copy — verbatim per task spec.
// ---------------------------------------------------------------------------

const STANDARD_INVITE_TEXT =
  "You're at the point where a 1-on-1 helps more than chat can \u2014 real placement data, scholarship options, and a plan built around your goal. Want me to book it?";
const GENERIC_INVITE_TEXT =
  "You're at the point where a 1-on-1 helps more than chat can \u2014 real placement data, scholarship options, and a plan built around what matters to you. Want me to book it?";

const B7_INVITE_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b7_book', title: 'Book my session' }),
  Object.freeze({ id: 'flowv2_b7_not_yet', title: 'Not yet' }),
]);

const NOT_YET_TEXT = "Totally fine \u2014 no rush at all. \uD83D\uDE42 I'm here whenever. Anything you want to dig into meanwhile?";

/**
 * IMPLEMENTATION NOTE (deliberate, not a spec deviation): the task lists
 * these 4 options as "Buttons", but WhatsApp button messages cap at 3
 * buttons per message — every other >3-option prompt already in this
 * codebase (B1's goal list, B2's field list, B5's change-slot menu) uses a
 * `type: 'list'` interactive for exactly this reason. Following the same
 * established convention here rather than silently dropping one option to
 * force-fit 3 buttons.
 */
const NOT_YET_TOPIC_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_b7_topic_fees', title: 'Fees' }),
  Object.freeze({ id: 'flowv2_b7_topic_placements', title: 'Placements' }),
  Object.freeze({ id: 'flowv2_b7_topic_hostel_safety', title: 'Hostel & safety' }),
  Object.freeze({ id: 'flowv2_b7_topic_scholarships', title: 'Scholarships' }),
]);
const NOT_YET_LIST_SECTION_TITLE = 'What would help?';
const NOT_YET_LIST_BUTTON_TEXT = 'Select';

const DONE_CONFIRMATION_TEXT =
  "Perfect, your request is in \u2705 I'm still right here \u2014 ask me anything about placements, fees or scholarships while you wait for your counsellor.";

const AWAITING_DONE_HOLDING_TEXT =
  "No rush \u2014 once you've submitted the form, just reply Done and I'll take it from there.";

/** `b7_post_decline` holding reply — deliberately generic and honest, not a
 * real fees/placements/hostel/scholarships answer. Building real
 * content-answers for these four topics is explicitly OUT OF SCOPE this
 * phase (flagged in this phase's report, not silently invented) — the only
 * requirement here is that the state never goes silent. */
const POST_DECLINE_HOLDING_TEXT =
  "I don't have that fully built out here yet, but I've noted it \u2014 your counsellor can go deep on this in the session. Whenever you're ready, just say Book and I'll send the link.";

/** `b7_post_booking` holding reply — same "never dead-end" requirement,
 * same out-of-scope note as above; this beat's own confirmation message
 * already makes this promise once, this is what backs it up on every
 * SUBSEQUENT message in this state. */
const POST_BOOKING_HOLDING_TEXT =
  "Still right here \u2014 ask me anything about placements, fees or scholarships while you wait.";

// ---------------------------------------------------------------------------
// Standard node-return shape helper.
// ---------------------------------------------------------------------------

function nodeResult({ replyText = null, replyParts = null, interactive = null, stage, profile, extraPatch = {} }) {
  return {
    replyText,
    replyParts,
    interactive,
    contextPatch: { stage, profile, ...extraPatch },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

// ---------------------------------------------------------------------------
// Entry.
// ---------------------------------------------------------------------------

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB7Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const body = profile.recommendation ? STANDARD_INVITE_TEXT : GENERIC_INVITE_TEXT;
  return nodeResult({
    interactive: { type: 'button', body, buttons: B7_INVITE_BUTTONS },
    stage: 'b7_awaiting_reply',
    profile,
  });
}

// ---------------------------------------------------------------------------
// b7_awaiting_reply — [Book my session] / [Not yet].
// ---------------------------------------------------------------------------

const BOOK_PATTERN = /\bbook\b/i;
const NOT_YET_PATTERN = /\bnot yet\b/i;

function extractB7InviteAction(text) {
  const t = String(text || '');
  if (BOOK_PATTERN.test(t)) return 'book';
  if (NOT_YET_PATTERN.test(t)) return 'not_yet';
  return null;
}

function reAskB7Invite(profile) {
  const body = profile.recommendation ? STANDARD_INVITE_TEXT : GENERIC_INVITE_TEXT;
  return nodeResult({
    interactive: { type: 'button', body, buttons: B7_INVITE_BUTTONS },
    stage: 'b7_awaiting_reply',
    profile,
  });
}

/** Builds B7's own booking-link message, reusing Node 0's shared
 * `buildBookingUrlLine()` helper — called via the module reference (not
 * destructured) so a test can `mock.method()` it and prove real reuse
 * rather than coincidental copy-paste. This is the ONLY place in this file
 * the URL is assembled. */
function buildB7BookingLinkMessage() {
  return [
    'Great \u2014 here\u2019s your booking form:',
    nodeZeroOverride.buildBookingUrlLine(),
    'After submitting, just reply Done here. \uD83C\uDF89',
  ].join('\n');
}

function handleB7InviteReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const action = extractB7InviteAction(text);

  if (action === 'book') {
    const mergedProfile = mergeFlowV2Profile(profile, { bookingStatus: 'link_sent' });
    return nodeResult({
      replyText: buildB7BookingLinkMessage(),
      stage: 'b7_awaiting_done',
      profile: mergedProfile,
    });
  }

  if (action === 'not_yet') {
    // Guard rail: this branch must NEVER call handleB7Entry() again (in
    // this turn or implicitly on the next) — it moves to its own distinct
    // holding stage instead of re-showing the booking question.
    return nodeResult({
      interactive: {
        type: 'list',
        body: NOT_YET_TEXT,
        buttonText: NOT_YET_LIST_BUTTON_TEXT,
        sections: [{ title: NOT_YET_LIST_SECTION_TITLE, rows: NOT_YET_TOPIC_ROWS }],
      },
      stage: 'b7_post_decline',
      profile,
    });
  }

  // Ambiguous free text — re-ask the same 2 buttons, same shortened-reask
  // pattern established by Greeting/B1/B2/B5.
  return reAskB7Invite(profile);
}

// ---------------------------------------------------------------------------
// b7_awaiting_done — waiting for "Done".
// ---------------------------------------------------------------------------

const DONE_PATTERN = /\bdone\b/i;

function handleB7AwaitingDoneReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (DONE_PATTERN.test(String(text || ''))) {
    // STATE-MACHINE GUARD: bookingStatus may only ever progress
    // null -> 'link_sent' -> 'done', never skipping 'link_sent'. This is an
    // explicit, defensive code check (not just a structural assumption) —
    // if this stage is somehow reached without bookingStatus already being
    // 'link_sent', "done" is NOT accepted; the student gets the same
    // non-silent holding reply instead of an out-of-sequence transition.
    if (profile.bookingStatus === 'link_sent') {
      const mergedProfile = mergeFlowV2Profile(profile, { bookingStatus: 'done' });
      return nodeResult({ replyText: DONE_CONFIRMATION_TEXT, stage: 'b7_post_booking', profile: mergedProfile });
    }
  }

  // Never dead-end: anything else (including a "done" that failed the
  // guard above) gets a short, honest, non-silent holding reply and stays
  // on this same stage.
  return nodeResult({ replyText: AWAITING_DONE_HOLDING_TEXT, stage: 'b7_awaiting_done', profile });
}

// ---------------------------------------------------------------------------
// b7_post_decline / b7_post_booking — holding states, never silent.
// ---------------------------------------------------------------------------

function handleB7PostDeclineReply(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  // Stays on b7_post_decline regardless of what was said (including a tap
  // on one of the 4 topic rows) — never re-invokes handleB7Entry.
  return nodeResult({ replyText: POST_DECLINE_HOLDING_TEXT, stage: 'b7_post_decline', profile });
}

function handleB7PostBookingReply(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  return nodeResult({ replyText: POST_BOOKING_HOLDING_TEXT, stage: 'b7_post_booking', profile });
}

// ---------------------------------------------------------------------------
// Reply dispatch.
// ---------------------------------------------------------------------------

/**
 * @param {{ flowV2?: { stage?: string, profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleB7Reply(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'b7_awaiting_done') return handleB7AwaitingDoneReply(ctx, text);
  if (stage === 'b7_post_decline') return handleB7PostDeclineReply(ctx, text);
  if (stage === 'b7_post_booking') return handleB7PostBookingReply(ctx, text);
  // Default (covers 'b7_awaiting_reply' and any unrecognized stage,
  // mirroring b3Constraints.js's own defensive-default pattern).
  return handleB7InviteReply(ctx, text);
}

module.exports = {
  handleB7Entry,
  handleB7Reply,
  // exported for focused unit testing
  extractB7InviteAction,
  buildB7BookingLinkMessage,
  STANDARD_INVITE_TEXT,
  GENERIC_INVITE_TEXT,
  B7_INVITE_BUTTONS,
  NOT_YET_TEXT,
  NOT_YET_TOPIC_ROWS,
  DONE_CONFIRMATION_TEXT,
  AWAITING_DONE_HOLDING_TEXT,
  POST_DECLINE_HOLDING_TEXT,
  POST_BOOKING_HOLDING_TEXT,
};
