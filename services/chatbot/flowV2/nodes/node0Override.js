'use strict';

/**
 * Flow v2 — Node 0 (booking override).
 *
 * Node 0 is a pre-empt, not a stage: `flowV2Dispatcher.processFlowV2Turn`
 * checks `detectOverrideIntent()` against every inbound message BEFORE any
 * stage-based routing, on every turn, regardless of `context.flowV2.stage`.
 * This lets a student jump straight to booking mid-Greeting (or from a
 * completely fresh conversation) without waiting for the current beat to
 * finish.
 *
 * Barely touches the profile by design — it only records that the booking
 * link was sent and flags the lead as hot, then asks ONE backfill question
 * so a later beat (B1) can pick up real goal-priority data without having
 * blocked the booking hand-off on it.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');

/**
 * Word-boundary-aware phrases (not bare substrings). E.g. "cancellation
 * policy" matches none of these phrases, and "humanities subjects" never
 * matches `human`, because `\bhuman\b` requires a word boundary immediately
 * after "human" — "humanities" has no such boundary ("n" is directly
 * followed by "i", both word characters).
 */
const OVERRIDE_PATTERNS = Object.freeze([
  /\bbook\b/i,
  /\bcall me\b/i,
  /\btalk to someone\b/i,
  /\bcounsellor\b/i,
  /\bcounselor\b/i,
  /\bsession\b/i,
  /\bhuman\b/i,
  /\bphone number\b/i,
  /\bconnect me\b/i,
  /\btalk to a person\b/i,
]);

/**
 * @param {string} text - inbound student message
 * @returns {boolean}
 */
function detectOverrideIntent(text) {
  const t = String(text || '');
  return OVERRIDE_PATTERNS.some((re) => re.test(t));
}

/** Single source of truth for the booking URL — a future URL change is a
 * one-line edit here, not a grep-and-hope across every file that mentions
 * it. */
const BOOKING_URL = 'guidexpert.co.in/one-on-one-session';

/**
 * Shared "here's the link" line, reused by B7 · Book (Phase 7 —
 * `b7Book.js`) so the URL is hand-typed in exactly this one place. Node 0's
 * and B7's surrounding copy are intentionally different strings (different
 * beats, different context) — only this atomic line is shared.
 */
function buildBookingUrlLine() {
  return `\uD83D\uDC49 ${BOOKING_URL}`;
}

const BOOKING_LINK_MESSAGE = [
  'Absolutely — here\u2019s your booking form:',
  buildBookingUrlLine(),
  'Once you submit, just reply Done here.',
].join('\n');

const BACKFILL_QUESTION =
  'While you\u2019re filling it — one quick thing so your counsellor walks in already knowing you. What matters most to you?';

const BACKFILL_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_backfill_placements', title: 'Placements' }),
  Object.freeze({ id: 'flowv2_backfill_ai_future_tech', title: 'AI & future tech' }),
  Object.freeze({ id: 'flowv2_backfill_affordable_safe', title: 'Affordable & safe' }),
]);

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape (see flowV2Dispatcher.js)
 */
function handleNode0Override(ctx, text) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(currentProfile, {
    bookingStatus: 'link_sent',
    temperature: 'hot',
  });

  // TODO(Phase 4): once B1 (Goal) exists, add a handler for
  // stage === 'node0_awaiting_backfill' that reads the tapped
  // backfill button (flowv2_backfill_*) and merges it into
  // profile.goalPriority, then hands off into B1 proper. This node
  // deliberately stops at setting the stage + profile below.
  return {
    replyText: BOOKING_LINK_MESSAGE,
    replyParts: null,
    interactive: {
      type: 'button',
      body: BACKFILL_QUESTION,
      buttons: BACKFILL_BUTTONS,
    },
    contextPatch: {
      stage: 'node0_awaiting_backfill',
      profile: mergedProfile,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  detectOverrideIntent,
  handleNode0Override,
  OVERRIDE_PATTERNS,
  BOOKING_LINK_MESSAGE,
  BACKFILL_QUESTION,
  BACKFILL_BUTTONS,
  // exported (Phase 7) so B7 · Book can reuse the exact same booking-URL
  // line rather than hand-typing it a second time.
  BOOKING_URL,
  buildBookingUrlLine,
};
