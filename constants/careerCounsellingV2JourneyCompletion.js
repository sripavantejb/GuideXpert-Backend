'use strict';

/**
 * GuideXpert V2 — Phase 14 Journey Completion & Platform Handoff.
 * Final AI journey phase: closure, handoff payload, final analytics.
 * No counseling / booking create / CRM.
 */

const STAGES = Object.freeze({
  PHASE_14_JOURNEY_COMPLETION: 'phase_14_journey_completion',
  JOURNEY_COMPLETED: 'journey_completed',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const PHASE14_STEPS = Object.freeze([
  'booking_complete',
  'journey_summary',
  'platform_handoff',
  'journey_completed',
]);

const PHASE14_ENGINE_VERSION = 'v1.0.0';

/** Overall AI Counseling Engine version at journey completion. */
const JOURNEY_VERSION = 'guidexpert_ai_counseling_engine_v1.0';

const JOURNEY_OUTCOMES = Object.freeze({
  BOOKING_INITIATED: 'booking_initiated',
  BOOKING_DEFERRED: 'booking_deferred',
  INFORMATION_ONLY: 'information_only',
  OPTED_OUT: 'opted_out',
  JOURNEY_COMPLETED: 'journey_completed',
});

const MESSAGES = Object.freeze({
  booking_initiated: [
    'Thank you!',
    '',
    'Your booking request has been received.',
    '',
    'Our admissions team will contact you shortly.',
    '',
    'We wish you the very best in your admission journey.',
  ].join('\n'),

  booking_deferred: [
    'No problem.',
    '',
    'You can return anytime and continue your admission journey.',
    '',
    "We'll be here whenever you're ready.",
  ].join('\n'),

  information_only: [
    "I'm glad I could help.",
    '',
    'If you need admission guidance in the future, feel free to come back.',
  ].join('\n'),

  opted_out: [
    'Understood.',
    '',
    'Thank you for chatting with GuideXpert.',
    '',
    'We wish you all the best.',
  ].join('\n'),

  journey_completed: [
    'Thank you for completing your GuideXpert counseling journey.',
    '',
    'We wish you the very best ahead.',
  ].join('\n'),

  sticky: [
    'Your counseling journey with GuideXpert is complete.',
    '',
    'Reply MENU for other options, or say *Send booking link* if you still need the booking form.',
  ].join('\n'),
});

function getPhase14Message(key) {
  return MESSAGES[key] || MESSAGES.journey_completed;
}

function isPhase14Stage(stage) {
  return (
    stage === STAGES.PHASE_14_JOURNEY_COMPLETION ||
    stage === STAGES.JOURNEY_COMPLETED
  );
}

function isPhase14Step(step) {
  return PHASE14_STEPS.includes(step);
}

module.exports = {
  STAGES,
  PHASE14_STEPS,
  PHASE14_ENGINE_VERSION,
  JOURNEY_VERSION,
  JOURNEY_OUTCOMES,
  MESSAGES,
  getPhase14Message,
  isPhase14Stage,
  isPhase14Step,
};
