'use strict';

/**
 * Flow v2 — B2.2 core-engineering fork.
 *
 * Fires the FIRST time a student's branch preference resolves to core
 * engineering (mechanical/civil/ECE/EEE) — either via a direct B2 list
 * tap, an R3/R4-D free-text statement ("I want mechanical"), or a
 * pre-filled `branchInterest` on B2 entry. `handleCoreForkEntry` is
 * gated by `profile.coreBridgeAttempted` so the pitch can never re-fire
 * for the same student (checked FIRST, before anything else, including
 * the parent variant).
 *
 * Three distinct sub-conversations live here (per spec, kept as three
 * functions rather than one, since they really are different flows):
 *   - `handleCoreForkEntry` — the initial nudge (student or parent variant)
 *   - `handleCoreForkReply` — routes the offer's three buttons (F1 / F2 /
 *     "tell me more")
 *   - `handleCoreForkTellMeMore` — the looping evidence-bubble sub-flow
 *     (F3), which re-shows the SAME three buttons rather than advancing
 *
 * F2 ("I want pure mechanical") routes into the SEPARATE honest-exit
 * sub-flow (`b2CoreForkExit.js`) — not handled inline here, since it has
 * its own multi-message sequence and its own terminal/non-terminal
 * branches.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, advanceToB3 } = require('../flowV2NodeUtils');
const { handleCoreForkExitEntry } = require('./b2CoreForkExit');

const OFFER_MESSAGE_1 =
  "Mechanical's a genuinely strong field \u2014 I'd never talk anyone out of it. Before I shortlist though, let me be straight with you about something most counsellors won't say out loud.";
const OFFER_MESSAGE_2 =
  "There's a running joke in Indian engineering: whatever branch you join, half the batch ends up writing code on placement day anyway \uD83D\uDE04 It's funny because it's largely true \u2014 the big recruiters hire across branches for software roles.";
const OFFER_MESSAGE_3 =
  "The flip side is the bit people miss. A CS student can work in almost any INDUSTRY \u2014 automotive, aerospace, healthcare, finance \u2014 because all of them run on software now. What they can't do is sign off a bridge \uD83D\uDE04 So it's not that core is weaker. It's that the software door is wider, and it opens from both sides.";
const OFFER_MESSAGE_4 =
  "So here's what I'd actually suggest. Let me show you colleges where you learn AI and coding properly \u2014 and you can still point that at robotics, automation or EV, which is where mechanical is heading anyway. You keep the interest. You just get the wider door. Want to see those?";

const PARENT_VARIANT_TEXT =
  "Both are good fields. The practical difference is that software roles hire in larger numbers and across more industries, so the job market is simply wider. That's the honest reason I'd nudge toward it. Want me to show you programs that combine both?";

const OFFER_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_core_fork_yes_show_me', title: 'Yes, show me' }),
  Object.freeze({ id: 'flowv2_core_fork_pure_mechanical', title: 'I want pure mechanical' }),
  Object.freeze({ id: 'flowv2_core_fork_tell_me_more', title: 'Tell me more first' }),
]);

const TELL_ME_MORE_BUBBLES = Object.freeze({
  mechanical:
    'Short version \u2014 mechanical is going software-heavy fast. Robotics and factory automation, EV battery and motor control, simulation and digital twins, CAD automation. Every one of those needs someone who can code. That person is usually the one leading the project, not assisting on it.',
  civil:
    'Short version \u2014 civil is going digital fast. BIM, smart infrastructure, structural simulation, drone survey and site analytics. The person who can code is the one running those projects.',
  // "also used for eee" per spec — EEE students get the same bubble as ECE.
  ece:
    'Honestly, ECE sits closest of all to this. Embedded systems, IoT, robotics, chip design tooling \u2014 all of it is code on top of hardware. Adding AI properly means you can go hardware OR software, and you keep both doors open.',
});

const F1_ACK_TEXT = 'Good call \u2014 that\u2019s the combination that actually holds up.';
const RETRY_OFFER_BODY = "Just so I get this right \u2014 which one?";

const YES_SHOW_ME_PATTERN = /\byes,?\s*show me\b/i;
const PURE_MECHANICAL_PATTERN = /\bpure mechanical\b/i;
const TELL_ME_MORE_PATTERN = /\btell me more\b/i;

/**
 * Resolves which field the offer's evidence bubble should cover.
 * Defaults to 'mechanical' when the student's message doesn't specify a
 * field (e.g. a generic "Core engineering (mech, civil, ECE)" list tap
 * with no field named) \u2014 a documented judgment call, consistent with
 * flowV2SlotExtractor.js's own default for the same generic row title.
 */
function extractCoreField(text) {
  const t = String(text || '').toLowerCase();
  const hasCivil = /\bcivil\b/.test(t);
  const hasEce = /\bece\b|\belectronics\b/.test(t);
  const hasEee = /\beee\b|\belectrical\b/.test(t);
  const hasMech = /\bmech(anical)?\b/.test(t);
  const matchCount = [hasCivil, hasEce, hasEee, hasMech].filter(Boolean).length;
  // A generic mention of multiple fields at once (e.g. B2's own
  // "Core engineering (mech, civil, ECE)" list-row title, which
  // literally contains all three examples) is not a genuine field
  // preference — default to mechanical rather than letting whichever
  // regex happens to be checked first win arbitrarily.
  if (matchCount >= 2) return 'mechanical';
  if (hasCivil) return 'civil';
  if (hasEce || hasEee) return 'ece';
  return 'mechanical';
}

function offerInteractive(body) {
  return { type: 'button', body, buttons: OFFER_BUTTONS };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} [text] - the message that resolved branch = core
 *   engineering, used to pick the tell-me-more field. Optional — defaults
 *   to 'mechanical' when omitted (e.g. arriving via a pre-filled skip).
 * @returns {object} standard Flow v2 node return shape
 */
function handleCoreForkEntry(ctx, text = '') {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // Guard rail: MUST be checked before ANY core-fork message is sent,
  // including the parent variant. Structurally this function should
  // never be re-entered once true (see b2Branch.js's own skip-check), but
  // this is the defense-in-depth backstop per spec.
  if (profile.coreBridgeAttempted === true) {
    return {
      replyText: null,
      replyParts: null,
      interactive: null,
      contextPatch: {},
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const coreField = extractCoreField(text);
  const mergedProfile = mergeFlowV2Profile(profile, {
    coreInterest: coreField,
    coreBridgeAttempted: true,
  });

  if (profile.isParent === true) {
    return {
      replyText: null,
      replyParts: null,
      interactive: offerInteractive(PARENT_VARIANT_TEXT),
      contextPatch: { stage: 'b2_core_fork_awaiting_reply', profile: mergedProfile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  return {
    replyText: null,
    replyParts: [OFFER_MESSAGE_1, OFFER_MESSAGE_2, OFFER_MESSAGE_3],
    interactive: offerInteractive(OFFER_MESSAGE_4),
    contextPatch: { stage: 'b2_core_fork_awaiting_reply', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * F1 — "Yes, show me": keep coreInterest, overwrite branchInterest to
 * 'cse_ai', ack, advance to B3.
 */
function acceptCoreForkPivot(ctx, profile) {
  const mergedProfile = mergeFlowV2Profile(profile, { branchInterest: 'cse_ai' });
  return advanceToB3(mergedProfile, F1_ACK_TEXT);
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleCoreForkReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '');

  if (YES_SHOW_ME_PATTERN.test(t)) {
    return acceptCoreForkPivot(ctx, profile);
  }

  if (PURE_MECHANICAL_PATTERN.test(t)) {
    // Routes to the honest-exit sub-flow \u2014 does NOT advance to B3 yet,
    // it has its own reply-handling state.
    return handleCoreForkExitEntry(withMergedProfile(ctx, profile));
  }

  if (TELL_ME_MORE_PATTERN.test(t)) {
    return handleCoreForkTellMeMore(ctx, text);
  }

  // Unrecognized reply \u2014 stay in the same stage, re-offer the same
  // three buttons rather than silently defaulting to any of them.
  return {
    replyText: null,
    replyParts: null,
    interactive: offerInteractive(RETRY_OFFER_BODY),
    contextPatch: { stage: 'b2_core_fork_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * F3 \u2014 "Tell me more first": ONE field-specific evidence bubble, then
 * re-shows the SAME three buttons \u2014 does NOT advance the stage away
 * from 'b2_core_fork_awaiting_reply', so the student can loop through
 * "tell me more" and still land on Y1/F2 afterward, and never
 * re-triggers the pitch itself (coreBridgeAttempted is already true by
 * the time this can ever run).
 *
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} [text] - unused; kept for a consistent handler
 *   signature with the other reply handlers in this file
 * @returns {object} standard Flow v2 node return shape
 */
function handleCoreForkTellMeMore(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const field = profile.coreInterest && TELL_ME_MORE_BUBBLES[profile.coreInterest] ? profile.coreInterest : 'mechanical';

  return {
    replyText: null,
    replyParts: [TELL_ME_MORE_BUBBLES[field]],
    interactive: offerInteractive(OFFER_MESSAGE_4),
    contextPatch: { stage: 'b2_core_fork_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleCoreForkEntry,
  handleCoreForkReply,
  handleCoreForkTellMeMore,
  // exported for focused unit testing
  extractCoreField,
  OFFER_MESSAGE_1,
  OFFER_MESSAGE_2,
  OFFER_MESSAGE_3,
  OFFER_MESSAGE_4,
  PARENT_VARIANT_TEXT,
  OFFER_BUTTONS,
  TELL_ME_MORE_BUBBLES,
  F1_ACK_TEXT,
};
