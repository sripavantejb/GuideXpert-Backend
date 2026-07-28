'use strict';

/**
 * Flow v2 — Greeting (first live beat).
 *
 * `handleGreetingEntry` fires when `context.flowV2.stage` is falsy (first
 * turn). `handleGreetingReply` fires while `stage === 'greeting_awaiting_reply'`.
 * Both are only ever invoked by `flowV2Dispatcher.processFlowV2Turn` — see
 * that file for the actual routing guarantee (this is the source of the
 * "never send the full greeting twice" contract, not node-file discipline
 * alone).
 */

const { extractFirstName } = require('../../welcomeMessageService');
const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');

const QUALIFICATION_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_qual_class10', title: 'Class 10' }),
  Object.freeze({ id: 'flowv2_qual_class11', title: 'Class 11' }),
  Object.freeze({ id: 'flowv2_qual_12_mpc', title: '12th — MPC' }),
  Object.freeze({ id: 'flowv2_qual_12_bipc', title: '12th — BiPC' }),
  Object.freeze({ id: 'flowv2_qual_12_mec_cec', title: '12th — MEC/CEC' }),
  Object.freeze({ id: 'flowv2_qual_diploma', title: 'Diploma' }),
  Object.freeze({ id: 'flowv2_qual_dropper', title: 'Dropper / gap year' }),
  Object.freeze({ id: 'flowv2_qual_college', title: 'Already in college' }),
  Object.freeze({ id: 'flowv2_qual_other', title: 'Something else' }),
]);

const QUALIFICATION_LIST_SECTION_TITLE = 'Where are you now?';
const QUALIFICATION_LIST_BUTTON_TEXT = 'Select';

const SHORT_REASK_BODY = "Sorry, didn't quite catch that 🙏 Pick the option that fits best:";

const GUESS_CONFIRM_YES = Object.freeze({ id: 'flowv2_guess_confirm_yes', title: "Yes, that's right" });
const GUESS_CONFIRM_NO = Object.freeze({ id: 'flowv2_guess_confirm_no', title: 'No, let me pick' });

function buildQualificationListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: QUALIFICATION_LIST_BUTTON_TEXT,
    sections: [{ title: QUALIFICATION_LIST_SECTION_TITLE, rows: QUALIFICATION_ROWS }],
  };
}

/**
 * Name resolution reuses the existing CRM-fullName pattern (no new name
 * storage invented) — same priority order as
 * services/chatbot/contextBuilderService.js's crmContext.name:
 * booking.fullName > iit.fullName > gx.fullName. There is no WhatsApp
 * contact display name stored anywhere in this codebase today.
 */
function resolveGreetingName(leadContext) {
  const fullName =
    leadContext?.booking?.fullName || leadContext?.iit?.fullName || leadContext?.gx?.fullName || null;
  return extractFirstName(fullName);
}

function buildGreetingText(firstName) {
  const hey = firstName ? `Hey ${firstName} 👋` : 'Hey there 👋';
  return [
    hey,
    '',
    "I'm Guide, from GuideXpert's counselling desk. We help students find a college that actually fits them — not just the ones with the biggest ads.",
    '',
    'Takes about 2 minutes.',
    '',
    'First — where are you right now?',
  ].join('\n');
}

/**
 * @param {{ flowV2?: { stage?: string|null }, leadContext?: object }} ctx
 * @returns {object} standard Flow v2 node return shape (see flowV2Dispatcher.js)
 */
function handleGreetingEntry(ctx) {
  // Defense-in-depth only — the real guarantee against double-greeting is
  // enforced by flowV2Dispatcher (only calls this when stage is falsy).
  if (ctx?.flowV2?.stage) {
    return {
      replyText: null,
      replyParts: null,
      interactive: null,
      contextPatch: {},
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const firstName = resolveGreetingName(ctx?.leadContext);
  return {
    replyText: buildGreetingText(firstName),
    replyParts: null,
    interactive: buildQualificationListInteractive('Tap the option that fits you:'),
    // door/temperature intentionally left at their tri-state `null` default —
    // LEAD_PROFILE_SCHEMA marks both writeBeats: ['B6'], so Greeting must
    // not set them here.
    contextPatch: { stage: 'greeting_awaiting_reply' },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * Narrow, deliberately conservative near-miss patterns that the confident
 * extractor (flowV2SlotExtractor.extractQualification) does NOT recognize
 * on its own — e.g. a bare "passed 10" without "th"/"class" is a weaker
 * signal, kept out of the confident path to avoid false positives
 * elsewhere, but still worth a one-tap confirm here rather than an
 * immediate re-ask.
 */
function guessQualificationFromFreeText(text) {
  const t = String(text || '').toLowerCase();
  if (/\bpassed\s*10\b|\bfinished\s*10\b|\bcompleted\s*10\b/.test(t)) return 'Class 10';
  if (/\bpassed\s*11\b|\bfinished\s*11\b|\bcompleted\s*11\b/.test(t)) return 'Class 11';
  if (/\bin college\b|\bat college\b|\bin university\b/.test(t)) return 'Already in college';
  return null;
}

function acceptQualification(ctx, qualification, extraPatch = {}) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(currentProfile, { ...extraPatch, qualification });
  return {
    // TODO(Phase 4): pick up from 'greeting_captured_pending_b1' and start B1 · Goal.
    replyText: `Got it — ${qualification}. Thanks!`,
    replyParts: null,
    interactive: null,
    contextPatch: {
      stage: 'greeting_captured_pending_b1',
      profile: mergedProfile,
      pendingQualificationGuess: null,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function offerGuessConfirm(guess) {
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: `Just to confirm — are you in ${guess}?`,
      buttons: [GUESS_CONFIRM_YES, GUESS_CONFIRM_NO],
    },
    contextPatch: {
      stage: 'greeting_awaiting_reply',
      pendingQualificationGuess: guess,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function reAskShortened() {
  return {
    replyText: null,
    replyParts: null,
    interactive: buildQualificationListInteractive(SHORT_REASK_BODY),
    contextPatch: {
      stage: 'greeting_awaiting_reply',
      pendingQualificationGuess: null,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object, pendingQualificationGuess?: string|null } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape (see flowV2Dispatcher.js)
 */
function handleGreetingReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const pendingGuess = ctx?.flowV2?.pendingQualificationGuess || null;
  const trimmedLower = String(text || '').trim().toLowerCase();

  if (pendingGuess) {
    if (/\byes\b/.test(trimmedLower)) return acceptQualification(ctx, pendingGuess);
    // An explicit "no" always defers to the short re-ask, even if the same
    // message also contains other useful free text — accepted
    // simplification for this phase (see plan judgment call #2/#3).
    if (/\bno\b/.test(trimmedLower)) return reAskShortened();
    // Anything else: the guess is stale — fall through and re-attempt
    // extraction on this new text instead of getting stuck.
  }

  const patch = extractFlowV2Slots(text, profile);
  if (patch.qualification) {
    const { qualification, ...rest } = patch;
    return acceptQualification(ctx, qualification, rest);
  }

  const guess = guessQualificationFromFreeText(text);
  if (guess) return offerGuessConfirm(guess);

  return reAskShortened();
}

module.exports = {
  handleGreetingEntry,
  handleGreetingReply,
  // exported for focused unit testing
  resolveGreetingName,
  buildGreetingText,
  guessQualificationFromFreeText,
  buildQualificationListInteractive,
  QUALIFICATION_ROWS,
  QUALIFICATION_LIST_SECTION_TITLE,
  QUALIFICATION_LIST_BUTTON_TEXT,
  SHORT_REASK_BODY,
  GUESS_CONFIRM_YES,
  GUESS_CONFIRM_NO,
  // Additive (Phase 3): reused by router/handlers/r10Handler.js so a
  // resolved ambiguous qualification (PCM/PCB silent-save, typo-guess
  // confirm) advances the stage exactly like a confident Greeting
  // extraction would — avoids re-asking an already-answered question.
  // No existing call site or behavior above is changed by this export.
  acceptQualification,
};
