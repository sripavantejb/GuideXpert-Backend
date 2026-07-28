'use strict';

/**
 * Flow v2 — B2.2 core-engineering fork, honest-exit sub-flow (F2).
 *
 * Fires when a student explicitly says "I want pure mechanical" after the
 * core-fork offer (`b2CoreFork.js`'s `handleCoreForkReply`). Kept as its
 * own file/state (not folded into `b2CoreFork.js`) because it has its own
 * four-message sequence and its own terminal ('parked_core') vs
 * non-terminal (transition back to the coding/AI pivot) branches.
 *
 * `profile.coreBridgeClosed = true` is set the moment this entry function
 * runs \u2014 this is the flag `b2Branch.js`'s `handleB2Entry` checks to make
 * re-offering the cse_ai pitch structurally impossible anywhere else in
 * the codebase, even if `branchInterest` is later reset to a core value
 * by something else.
 *
 * ANGER-SHAPED REPLY DETECTION: no existing utility in this codebase
 * detects frustration/anger phrasing like "waste of time" or "why did
 * you even ask" \u2014 `classifyReply.js`'s R12_HOSTILE_PATTERNS is a
 * DIFFERENT, narrower thing (prompt-injection / bot-testing phrasing:
 * "are you chatgpt", "ignore your instructions", etc.), confirmed by
 * inspection to NOT overlap with these phrases. `isAngerShaped` below is
 * therefore new, small, and deliberately conservative \u2014 flagged in this
 * phase's output per the task's explicit instruction to show it rather
 * than silently reusing something that doesn't actually apply.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { advanceToB3 } = require('../flowV2NodeUtils');

const EXIT_MESSAGE_1 =
  "Respect \u2014 and honestly, if mechanical is what you want, you should do mechanical. Clear decisions beat hedged ones.";
const EXIT_MESSAGE_2 =
  "I should be straight with you about my own limits though. GuideXpert's depth is in CSE and AI-based careers \u2014 that's what I can genuinely shortlist and compare properly. For pure mechanical I'd be guessing, and I'd rather tell you that than send you somewhere wrong.";
const EXIT_MESSAGE_3 = [
  "What I can do is hand you the checklist I'd use if I were picking a mechanical college myself:",
  '\u2022 Go SEE the workshop and labs. Photos lie.',
  '\u2022 Ask which simulation tools they actually teach \u2014 SolidWorks, ANSYS, CATIA \u2014 and who teaches them.',
  '\u2022 Ask for CORE placement numbers specifically, not the overall percentage. The gap is usually large.',
  '\u2022 Ask about internship tie-ups with auto or manufacturing firms, by name.',
  '\u2022 If a PSU is the goal, ask what GATE support looks like.',
  "Ask any college those five and you'll learn more than a brochure will ever tell you.",
].join('\n');
const EXIT_MESSAGE_4 =
  "And if you ever want to look at the AI-plus-mechanical route \u2014 robotics, automation, EV \u2014 I'm right here. No pressure at all. All the best, genuinely. \uD83D\uDC4D";

const EXIT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_core_exit_thanks', title: 'Thanks, that helps' }),
  Object.freeze({ id: 'flowv2_core_exit_tell_me_about_route', title: 'Actually, tell me about that route' }),
]);

const WARM_CLOSE_TEXT = "Good luck with it \u2014 and if a friend's looking at CSE or AI, send them my way \uD83D\uDE42";
const TRANSITION_TEXT =
  "Happy to. Two quick taps and I'll show you programs where you build AI and coding properly, with project work that runs into robotics and automation.";
const APOLOGY_TEXT =
  "That's fair, and I'm sorry \u2014 I should have flagged my scope earlier. The checklist above is the same one I'd give a student who paid for a session, so at least take that with you. Genuinely wishing you well with it.";
const NEUTRAL_CLOSE_TEXT = "No worries \u2014 I'll leave it there. All the best! \uD83D\uDC4D";

const THANKS_PATTERN = /\bthanks,?\s*that helps\b/i;
const TRANSITION_PATTERN = /\bactually,?\s*tell me about that route\b/i;

/** New (see module docstring) \u2014 deliberately conservative, not an
 * exhaustive profanity/frustration filter. */
const ANGER_PATTERNS = Object.freeze([
  /\bwaste(d)?( of time)?\b/i,
  /\bwhy did you even ask\b/i,
  /\bpointless\b/i,
  /\bwhat('?s| is) the point\b/i,
  /\bforget it\b/i,
]);
function isAngerShaped(text) {
  const t = String(text || '');
  return ANGER_PATTERNS.some((re) => re.test(t));
}

function parkedCoreReply(profile, replyText) {
  return {
    replyText,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: 'parked_core', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleCoreForkExitEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(profile, {
    branchInterest: 'core',
    coreBridgeClosed: true,
  });

  return {
    replyText: null,
    replyParts: [EXIT_MESSAGE_1, EXIT_MESSAGE_2, EXIT_MESSAGE_3],
    interactive: { type: 'button', body: EXIT_MESSAGE_4, buttons: EXIT_BUTTONS },
    contextPatch: { stage: 'b2_core_exit_awaiting_reply', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleCoreForkExitReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '');

  if (THANKS_PATTERN.test(t)) {
    return parkedCoreReply(profile, WARM_CLOSE_TEXT);
  }

  if (TRANSITION_PATTERN.test(t)) {
    // Overwrites branchInterest to 'cse_ai', keeps coreInterest, advances
    // directly to B3. Structurally cannot re-trigger the joke/pitch \u2014
    // coreBridgeAttempted is already true from the fork's own entry.
    const mergedProfile = mergeFlowV2Profile(profile, { branchInterest: 'cse_ai' });
    return advanceToB3(mergedProfile, TRANSITION_TEXT);
  }

  if (isAngerShaped(t)) {
    return parkedCoreReply(profile, APOLOGY_TEXT);
  }

  // Unrecognized reply \u2014 do NOT loop the four-message exit sequence
  // again (that would be its own guard-rail violation); close neutrally.
  return parkedCoreReply(profile, NEUTRAL_CLOSE_TEXT);
}

module.exports = {
  handleCoreForkExitEntry,
  handleCoreForkExitReply,
  // exported for focused unit testing
  isAngerShaped,
  EXIT_MESSAGE_1,
  EXIT_MESSAGE_2,
  EXIT_MESSAGE_3,
  EXIT_MESSAGE_4,
  EXIT_BUTTONS,
  WARM_CLOSE_TEXT,
  TRANSITION_TEXT,
  APOLOGY_TEXT,
  NEUTRAL_CLOSE_TEXT,
};
