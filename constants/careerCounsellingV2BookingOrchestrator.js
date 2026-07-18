'use strict';

/**
 * GuideXpert V2 — Phase 13 Booking Orchestrator.
 * Owns booking CTA / URL / routing / progress. No counseling logic.
 * Production freeze baseline v1.0.0 — journey complete; do not change without freeze waiver.
 */

const STAGES = Object.freeze({
  PHASE_13_BOOKING_ORCHESTRATOR: 'phase_13_booking_orchestrator',
  /** Legacy stub stage — routed to orchestrator for handoff compatibility. */
  PHASE_13_BOOKING_PLACEHOLDER: 'phase_13_booking_placeholder',
  PHASE_14_JOURNEY_COMPLETION: 'phase_14_journey_completion',
  JOURNEY_COMPLETED: 'journey_completed',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const PHASE13_STEPS = Object.freeze([
  'booking_intro',
  'booking_presented',
  'booking_confirmed',
  'booking_deferred',
  'booking_completed',
]);

/** Production freeze baseline. Do not change behavior without explicit freeze waiver. Journey complete — no Phase 14. */
const PHASE13_ENGINE_VERSION = 'v1.0.0';

/** Official single booking form base — URLs only via BOOKING_SERVICE_REGISTRY. */
const OFFICIAL_BOOKING_FORM_BASE = 'https://www.guidexpert.co.in/one-on-one-session';

/**
 * Canonical booking destination registry.
 * Prefer single_form + service query param unless Product sets dedicated_form.
 */
const BOOKING_SERVICE_REGISTRY = Object.freeze({
  one_on_one: Object.freeze({
    serviceKey: 'one_on_one',
    formMode: 'single_form',
    baseUrl: OFFICIAL_BOOKING_FORM_BASE,
    serviceParam: 'one_on_one',
    ctaLabel: 'One-on-One counseling',
    metadata: Object.freeze({ kind: 'counseling_session' }),
  }),
  admission: Object.freeze({
    serviceKey: 'admission',
    formMode: 'single_form',
    baseUrl: OFFICIAL_BOOKING_FORM_BASE,
    serviceParam: 'admission',
    ctaLabel: 'Admission counseling',
    metadata: Object.freeze({ kind: 'counseling_session' }),
  }),
  career: Object.freeze({
    serviceKey: 'career',
    formMode: 'single_form',
    baseUrl: OFFICIAL_BOOKING_FORM_BASE,
    serviceParam: 'career',
    ctaLabel: 'Career counseling',
    metadata: Object.freeze({ kind: 'counseling_session' }),
  }),
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

const MESSAGES = Object.freeze({
  intro: [
    'Optional next step: book your selected *{ctaLabel}* session on the GuideXpert website.',
    '',
    'I won’t create a booking inside WhatsApp.',
    '',
    'Reply *Book now*, *Later*, or ask a short question about booking.',
  ].join('\n'),

  url_share: [
    'Here’s the official booking form for your *{ctaLabel}* session:',
    '',
    '{url}',
    '',
    'Complete it on the website when you’re ready. I can’t create the booking inside WhatsApp.',
    '',
    'Reply *Done* when finished, or ask a short booking question.',
  ].join('\n'),

  deferred: [
    'No pressure — booking stays optional.',
    '',
    'When you’re ready later, say *Send booking link* or *Book now*.',
  ].join('\n'),

  question_fallback: [
    'Booking happens on the GuideXpert website form — not inside WhatsApp.',
    '',
    'Reply *Book now* for the official link, *Later* to stop, or ask another short booking question.',
  ].join('\n'),

  clarify: 'Reply *Book now*, *Later*, or ask a short booking question.',

  confirmed_intent: [
    'Great — finish on the website form when you can.',
    '',
    'Reply *Done* anytime. Say *Send booking link* if you need the form again.',
  ].join('\n'),

  skipped_none: [
    'No booking step is needed from your counseling selection.',
    '',
    'Reply *Done* when you’re finished.',
  ].join('\n'),

  skipped_already_offered: [
    'You’ve already been pointed to a One-on-One booking path.',
    '',
    'We won’t send another booking link here.',
    '',
    'Reply *Done* when you’re finished.',
  ].join('\n'),

  resume_no_service: [
    'I don’t have a counseling booking selection stored yet.',
    '',
    'Finish the counseling journey first, or reply MENU for other options.',
  ].join('\n'),

  abandoned: [
    'I couldn’t map a booking destination for this session.',
    '',
    'Reply MENU for other options.',
  ].join('\n'),

  greeting_mid: 'Still here. Reply *Book now*, *Later*, or ask a booking question.',

  complete_sticky:
    'This booking conversation is complete. Say *Send booking link* if you still need the form, or MENU for other options.',
});

function getPhase13Message(key) {
  return MESSAGES[key] || '';
}

function isPhase13Stage(stage) {
  return (
    stage === STAGES.PHASE_13_BOOKING_ORCHESTRATOR ||
    stage === STAGES.PHASE_13_BOOKING_PLACEHOLDER
  );
}

function isPhase13Step(step) {
  return (
    PHASE13_STEPS.includes(step) ||
    step === 'phase13_booking_placeholder' ||
    step === 'phase13_booking_orchestrator_placeholder'
  );
}

module.exports = {
  STAGES,
  PHASE13_STEPS,
  PHASE13_ENGINE_VERSION,
  OFFICIAL_BOOKING_FORM_BASE,
  BOOKING_SERVICE_REGISTRY,
  GUARANTEE_FORBIDDEN,
  MESSAGES,
  getPhase13Message,
  isPhase13Stage,
  isPhase13Step,
};
