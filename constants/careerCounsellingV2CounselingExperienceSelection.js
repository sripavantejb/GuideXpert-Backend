'use strict';

/**
 * GuideXpert V2 — Phase 12 Counseling Experience Selection.
 * Deterministic service routing after Phase 11 (no booking URLs).
 * Production freeze baseline v1.0.0 — do not change behavior without freeze waiver.
 */

const STAGES = Object.freeze({
  PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION:
    'phase_12_personalized_counseling_recommendation',
  /** Handoff target — Phase 13 owns booking; Phase 12 never exposes URLs. */
  PHASE_13_BOOKING_ORCHESTRATOR: 'phase_13_booking_orchestrator',
  PHASE_13_BOOKING_PLACEHOLDER: 'phase_13_booking_placeholder',
  PHASE_14_JOURNEY_COMPLETION: 'phase_14_journey_completion',
  JOURNEY_COMPLETED: 'journey_completed',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const PHASE12_STEPS = Object.freeze([
  'counsel_rec_present',
  'counsel_rec_followup',
]);

/** Production freeze baseline. Do not change behavior without explicit freeze waiver. */
const PHASE12_ENGINE_VERSION = 'v1.0.0';

const COUNSELING_SERVICES = Object.freeze({
  ONE_ON_ONE: 'one_on_one',
  ADMISSION: 'admission',
  CAREER: 'career',
  NONE: 'none',
});

const GUARANTEE_FORBIDDEN = Object.freeze([
  /\bguaranteed?\b/i,
  /\bassure[ds]?\b/i,
  /\bwill (get|secure|land)\b/i,
  /\b100%\b/,
  /\bmust (book|decide|join)\b/i,
  /\byou have to\b/i,
  /\bmandatory\b/i,
]);

const URL_FORBIDDEN = Object.freeze([
  /https?:\/\//i,
  /guidexpert\.co\.in/i,
  /www\./i,
]);

const MESSAGES = Object.freeze({
  soft_prompt_continue: [
    'If you’d like, we can move to booking next.',
    '',
    'Reply *Continue*, *Ready*, *Proceed*, *Book now* or ask a question.',
  ].join('\n'),

  soft_prompt_none: [
    'You’re in a solid place from the counseling journey so far.',
    '',
    'No extra counseling service is selected unless you want one later.',
    '',
    'Reply *Done* when you’re finished, or *Continue* if you still want to explore booking later.',
  ].join('\n'),

  continue_clarify:
    'Reply *Continue*, *Ready*, *Proceed*, or *Book now* to get the booking form, *Not now* to finish, or ask a short question.',

  declined:
    'No pressure — this stays optional. You can return anytime if you want personalized counseling later.',

  skipped_already_offered: [
    'You’ve already been pointed to a One-on-One counseling path.',
    '',
    'We won’t recommend another counseling experience here.',
    '',
    'Reply *Done* when you’re finished.',
  ].join('\n'),

  phase13_stub: [
    'Next step is booking for your selected counseling experience.',
    '',
    'Booking details come in the next stage — nothing to book inside this chat yet.',
    '',
    'Reply *Done* when you’re finished here.',
  ].join('\n'),

  greeting_mid: 'Still here. Want to *Continue* toward booking, or *Not now*?',

  question_fallback: [
    'Happy to clarify from what you’ve already shared in counseling.',
    '',
    'I won’t reopen college comparisons or rankings here.',
    '',
    'Reply *Continue*, *Not now*, or ask another short question.',
  ].join('\n'),
});

function getPhase12Message(key) {
  return MESSAGES[key] || '';
}

module.exports = {
  STAGES,
  PHASE12_STEPS,
  PHASE12_ENGINE_VERSION,
  COUNSELING_SERVICES,
  GUARANTEE_FORBIDDEN,
  URL_FORBIDDEN,
  MESSAGES,
  getPhase12Message,
};
