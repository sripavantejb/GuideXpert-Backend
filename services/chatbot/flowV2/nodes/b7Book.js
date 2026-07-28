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
 * HYBRID BOOKING (Flow V3 Phase 1 / HYBRID_BOOKING_WEBSITE_CREATE):
 * [Book my session] shows live slots via Node 0 shared helpers, then hands
 * off to the official website URL. WhatsApp never creates CRM bookings.
 *
 * Introduces stages, none of which may ever go silent on an arbitrary next
 * message (Flow v2's "never dead-end" rule):
 *   b7_awaiting_reply  -> the initial [Book my session]/[Not yet] question
 *   b7_awaiting_slot   -> live slot list (hybrid); next message → website URL
 *   b7_awaiting_done   -> link already sent, waiting for "Done"
 *   b7_post_decline    -> student said "Not yet"; holding state
 *   b7_post_booking    -> booking confirmed; holding state (not a dead end
 *                         for the whole conversation, just for this beat)
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const nodeZeroOverride = require('./node0Override');
const { startBookingFollowups } = require('../bookingFollowupService');

// ---------------------------------------------------------------------------
// Copy — verbatim per task spec.
// ---------------------------------------------------------------------------

const STANDARD_INVITE_TEXT = [
  "You're at an important stage in your career.",
  'One good decision now can save years of confusion later.',
  "That's why GuideXpert offers a FREE 1:1 Career Guidance Session with an IITian.",
  "In this session, you'll understand:",
  '✅ Which college suits you best',
  '✅ Which branch matches your strengths',
  '✅ Career opportunities after graduation',
  '✅ Scholarships you may qualify for',
  "It's completely free.",
  'Would you like to book your session?',
].join('\n');
const GENERIC_INVITE_TEXT = STANDARD_INVITE_TEXT;

// Company Stage 10 buttons (titles ≤20). Calendar emoji kept for Book.
const B7_INVITE_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b7_book', title: '📅 Book My Session' }),
  Object.freeze({ id: 'flowv2_b7_not_yet', title: 'Maybe Later' }),
]);

const NOT_YET_TEXT =
  "Totally fine — no rush at all 🙂\nI'm here whenever. Anything you want to dig into meanwhile?";

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
  "Perfect, your request is in \u2705\nI'm still right here \u2014 ask me anything about placements, fees or scholarships while you wait for your counsellor.";

const AWAITING_DONE_HOLDING_TEXT =
  "No rush \u2014 once you've submitted the form, just reply Done and I'll take it from there.";

/** `b7_post_decline` holding reply — deliberately generic and honest, not a
 * real fees/placements/hostel/scholarships answer. Building real
 * content-answers for these four topics is explicitly OUT OF SCOPE this
 * phase (flagged in this phase's report, not silently invented) — the only
 * requirement here is that the state never goes silent. */
const POST_DECLINE_HOLDING_TEXT =
  "I'm here whenever. Pick fees, placements, hostel & safety, or scholarships and I'll help with that.";

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
const NOT_YET_PATTERN = /\bnot (yet|right now)\b|\bmaybe later\b/i;

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
 * the URL is assembled. Optional preferred-slot hint is non-binding only
 * (HYBRID_BOOKING_WEBSITE_CREATE — no CRM create from WhatsApp). */
function buildB7BookingLinkMessage(preferredSlotLabel = null) {
  const hint = preferredSlotLabel
    ? `Got it — ${preferredSlotLabel} noted as a preference.\n\n`
    : '';
  return [
    `${hint}Great \u2014 here\u2019s your booking form:`,
    nodeZeroOverride.buildBookingUrlLine(),
    '',
    'In the session your counsellor will:',
    '\u2022 Compare colleges against YOUR goals',
    '\u2022 Walk through placements, internships and scholarships',
    '\u2022 Answer anything still open',
    '',
    'After submitting, just reply Done here. \uD83D\uDE4C',
  ].join('\n');
}

const B7_SLOT_PICKER_BODY = '\uD83D\uDC4D When suits you?';

async function handleB7InviteReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const action = extractB7InviteAction(text);

  if (action === 'book') {
    // HYBRID_BOOKING_WEBSITE_CREATE — live slots first, then website URL.
    return nodeZeroOverride.buildHybridSlotPickerResult(ctx, {
      stage: 'b7_awaiting_slot',
      body: B7_SLOT_PICKER_BODY,
    });
  }

  if (action === 'not_yet') {
    const declinedProfile = mergeFlowV2Profile(profile, startBookingFollowups());
    return nodeResult({
      replyText:
        "Totally fine — no rush at all 🙂\nI'm here whenever you're ready to book your free IITian session.",
      replyParts: null,
      interactive: null,
      stage: 'b7_post_decline',
      profile: declinedProfile,
    });
  }

  // Ambiguous free text — re-ask the same 2 buttons, same shortened-reask
  // pattern established by Greeting/B1/B2/B5.
  return reAskB7Invite(profile);
}

function handleB7SlotReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const offers = ctx?.flowV2?.hybridSlotOffers || [];
  const choice = nodeZeroOverride.resolveHybridSlotChoice(text, offers);
  const mergedProfile = mergeFlowV2Profile(profile, { bookingStatus: 'link_sent' });
  return nodeResult({
    replyText: buildB7BookingLinkMessage(choice.preferredSlotLabel),
    stage: 'b7_awaiting_done',
    profile: mergedProfile,
    extraPatch: { hybridSlotOffers: null, preferredSlotHint: choice.preferredSlotLabel },
  });
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

const TOPIC_REPLIES = Object.freeze({
  fees:
    'For fees, compare the total yearly cost \u2014 tuition, hostel, deposits and compulsory extras \u2014 not just the headline number. Verify the current figure with each college before deciding.',
  placements:
    'For placements, ask for branch-specific numbers: eligible students, students placed, median package and the companies that hired. Overall percentages can hide a lot.',
  hostel:
    'For hostel and safety, check supervision, transport, curfew policy, medical support and how complaints are handled. A campus visit is the best verification.',
  scholarships:
    'For scholarships, check eligibility, renewal conditions, the amount covered and whether it applies to tuition only. Current terms should be confirmed directly with the college.',
});

function topicReply(text) {
  const value = String(text || '');
  if (/\bfees?\b/i.test(value)) return TOPIC_REPLIES.fees;
  if (/\bplacements?\b/i.test(value)) return TOPIC_REPLIES.placements;
  if (/\bhostel\b|\bsafety\b/i.test(value)) return TOPIC_REPLIES.hostel;
  if (/\bscholarships?\b|\baid\b/i.test(value)) return TOPIC_REPLIES.scholarships;
  return null;
}

async function handleB7PostDeclineReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (BOOK_PATTERN.test(String(text || ''))) {
    return nodeZeroOverride.buildHybridSlotPickerResult(ctx, {
      stage: 'b7_awaiting_slot',
      body: B7_SLOT_PICKER_BODY,
    });
  }
  return nodeResult({ replyText: topicReply(text) || POST_DECLINE_HOLDING_TEXT, stage: 'b7_post_decline', profile });
}

function handleB7PostBookingReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  return nodeResult({ replyText: topicReply(text) || POST_BOOKING_HOLDING_TEXT, stage: 'b7_post_booking', profile });
}

// ---------------------------------------------------------------------------
// Reply dispatch.
// ---------------------------------------------------------------------------

/**
 * @param {{ flowV2?: { stage?: string, profile?: object } }} ctx
 * @param {string} text
 * @returns {Promise<object>|object} standard Flow v2 node return shape
 */
async function handleB7Reply(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'b7_awaiting_slot') return handleB7SlotReply(ctx, text);
  if (stage === 'b7_awaiting_done') return handleB7AwaitingDoneReply(ctx, text);
  if (stage === 'b7_post_decline') return await handleB7PostDeclineReply(ctx, text);
  if (stage === 'b7_post_booking') return handleB7PostBookingReply(ctx, text);
  // Default (covers 'b7_awaiting_reply' and any unrecognized stage,
  // mirroring b3Constraints.js's own defensive-default pattern).
  return await handleB7InviteReply(ctx, text);
}

module.exports = {
  handleB7Entry,
  handleB7Reply,
  handleB7SlotReply,
  // exported for focused unit testing
  extractB7InviteAction,
  buildB7BookingLinkMessage,
  B7_SLOT_PICKER_BODY,
  STANDARD_INVITE_TEXT,
  GENERIC_INVITE_TEXT,
  B7_INVITE_BUTTONS,
  NOT_YET_TEXT,
  NOT_YET_TOPIC_ROWS,
  DONE_CONFIRMATION_TEXT,
  AWAITING_DONE_HOLDING_TEXT,
  POST_DECLINE_HOLDING_TEXT,
  POST_BOOKING_HOLDING_TEXT,
  TOPIC_REPLIES,
};
