'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 9 Personalized Recommendation Synthesis.
 * Deterministic explainable recommendations from existing journey context (no LLM).
 */

const STAGES = Object.freeze({
  PHASE_9_PERSONALIZED_RECOMMENDATION: 'phase_9_personalized_recommendation',
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

const PHASE9_STEPS = Object.freeze([
  'phase9_present',
  'phase9_followup',
]);

/** Audited production contract (freeze baseline). Do not change behavior without explicit approval. */
const PHASE9_ENGINE_VERSION = 'v1.1.0';

/** Display ranks (max 3). */
const RANK_LABELS = Object.freeze({
  best: 'Best Match',
  strong: 'Strong Alternative',
  backup: 'Good Backup',
});

/** Human-friendly confidence (never raw scores). */
const CONFIDENCE_LABELS = Object.freeze({
  excellent: 'Excellent Match',
  strong: 'Strong Match',
  good: 'Good Match',
});

const MESSAGES = Object.freeze({
  header: 'Why {{college}} appears to be a strong fit for you',

  empty: [
    'I don’t have enough shortlist context yet to recommend confidently.',
    '',
    'We can still continue — a counsellor can help fill the gaps.',
  ].join('\n'),

  tradeoffs_header: '*How they differ*',

  recommendation_prefix:
    "Based on everything you've shared, {{college}} aligns well with your goals because:",

  soft_transition: [
    'If you are ready, we can now explore what your future path could look like from this choice.',
  ].join('\n'),

  ask_continue: 'Would you like to continue to the next step?',

  continue_clarify: 'Reply *Continue* when ready, or ask about fees, location, or fit.',

  greeting_mid: 'Still here. Let’s finish your best-fit recommendation.',

  weak_confidence_note:
    'Some profile signals are still thin — treat this as decision support, not certainty.',

  resume_prefix: 'Back to your recommendation:',
});

function getPhase9Message(key) {
  return MESSAGES[key] || '';
}

const PHASE9_QA = Object.freeze([
  {
    patterns: [/why.*(best|first|recommend)/i, /why (this|these)/i],
    answer:
      'These are the same colleges from your Phase 5 shortlist, explained with your profile — ranking is not re-calculated here.',
  },
  {
    patterns: [/comparison|lean|prefer/i],
    answer:
      'Comparison Insight is informational only. It does not change your Best Match / Strong Alternative order from the shortlist.',
  },
  {
    patterns: [/confidence|how sure|certain/i],
    answer:
      'Labels like Excellent / Strong / Good Match summarize fit from your profile. I don’t show raw scores.',
  },
  {
    patterns: [/trade-?off|difference|differ/i],
    answer:
      'Trade-offs highlight fee, location, and fit differences between your top options — so you can choose deliberately.',
  },
  {
    patterns: [/next|phase 10|vision|future/i],
    answer:
      'Next we can explore what your future path could look like — after you’re ready to continue.',
  },
]);

module.exports = {
  STAGES,
  PHASE9_STEPS,
  PHASE9_ENGINE_VERSION,
  RANK_LABELS,
  CONFIDENCE_LABELS,
  MESSAGES,
  PHASE9_QA,
  getPhase9Message,
};
