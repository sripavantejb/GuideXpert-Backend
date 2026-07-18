'use strict';

/**
 * GuideXpert V2 — Phase 10 Future Path Vision.
 * Deterministic confidence + learning-journey visualization (no LLM, no CTA).
 */

const STAGES = Object.freeze({
  PHASE_10_FUTURE_PATH_VISION: 'phase_10_future_path_vision',
  PHASE_11_FINAL_DECISION_HESITATION: 'phase_11_final_decision_hesitation',
  PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION: 'phase_12_personalized_counseling_recommendation',
  PHASE_13_BOOKING_ORCHESTRATOR: 'phase_13_booking_orchestrator',
  PHASE_13_BOOKING_PLACEHOLDER: 'phase_13_booking_placeholder',
  PHASE_14_JOURNEY_COMPLETION: 'phase_14_journey_completion',
  JOURNEY_COMPLETED: 'journey_completed',
  COUNSELING_INVITATION: 'counseling_invitation',
  COUNSELING_INVITATION_PLACEHOLDER: 'counseling_invitation_placeholder',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const PHASE10_STEPS = Object.freeze(['vision_present', 'vision_followup']);

/** Production freeze baseline. Do not change behavior without explicit freeze waiver. */
const PHASE10_ENGINE_VERSION = 'v1.0.0';

const MESSAGES = Object.freeze({
  ask_continue: 'Reply *Continue* when ready.',

  continue_clarify: 'Reply *Continue* when ready, or ask about the learning journey ahead.',

  greeting_mid: 'Still here. Let’s finish picturing your path.',

  empty_profile: [
    'You’ve already done meaningful counseling work.',
    '',
    'Next you can picture how skills and projects could build over time on your chosen path.',
    '',
    'Reply *Continue* when ready.',
  ].join('\n'),

  deflect_college_facts:
    'College details were covered earlier. Here we’re focusing on what learning could look like on your path.',

  deflect_objection:
    'That’s a fair worry — we’ll keep it noted. For now, let’s stay with the learning journey ahead.',

  deflect_booking:
    'Next steps come after this. For now, let’s stay with your future learning path.',
});

const PHASE10_QA = Object.freeze([
  {
    patterns: [/what.*(learn|skill|study|project)/i, /how.*(grow|prepare|learn)/i],
    answer:
      'Think in possibilities: early fundamentals, then projects and practice that match how you like to learn — not guaranteed outcomes.',
  },
  {
    patterns: [/guarante|sure to get|will i get|package|placement %|salary/i],
    answer:
      'I don’t promise placements, packages, or admissions. This is about possible preparation and growth on your path.',
  },
  {
    patterns: [/book|counsellor|counselor|session|meeting/i],
    answer:
      'Next steps come after this vision step. For now we’re only picturing the learning journey.',
  },
  {
    patterns: [/compar|which college|rank|best match again/i],
    answer:
      'We’re not re-comparing colleges here — only imagining the learning journey on the path you already have.',
  },
]);

/** Patterns that must never appear in Phase 10 outbound copy. */
const GUARANTEE_FORBIDDEN = Object.freeze([
  /\bguaranteed?\b/i,
  /\bassure[ds]?\b/i,
  /\bwill (get|secure|land)\b/i,
  /\b100%\b/,
  /\bplacement(s)? (guaranteed|assured|confirmed)\b/i,
  /\bpackage (of|is|will)\b/i,
  /\badmission (guaranteed|assured|confirmed)\b/i,
]);

function getPhase10Message(key) {
  return MESSAGES[key] || '';
}

module.exports = {
  STAGES,
  PHASE10_STEPS,
  PHASE10_ENGINE_VERSION,
  MESSAGES,
  PHASE10_QA,
  GUARANTEE_FORBIDDEN,
  getPhase10Message,
};
