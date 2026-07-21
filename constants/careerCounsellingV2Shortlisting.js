'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 5 AI Personalized Shortlisting.
 * Eligibility via College Dost predictor; recommendation via configurable matrix.
 */

const STAGES = Object.freeze({
  AI_SHORTLISTING: 'ai_shortlisting',
  SMART_COMPARISON: 'smart_comparison',
  CONCERN_RESOLUTION: 'concern_resolution',
  CONCERN_RESOLUTION_PLACEHOLDER: 'concern_resolution_placeholder',
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
  /** @deprecated use SMART_COMPARISON */
  COMPARISON_PLACEHOLDER: 'comparison_placeholder',
});

const SHORTLISTING_STEPS = Object.freeze([
  'shortlist_validate',
  'shortlist_ask_exam',
  'shortlist_ask_rank',
  'shortlist_ask_category',
  'shortlist_present',
  'shortlist_ask_compare',
]);

const RECOMMENDATION_MATRIX_VERSION = 'v1.0.0';

/**
 * Configurable recommendation weights (sum need not be 100; normalized at score time).
 * Eligibility is separate — these only score already-eligible colleges.
 */
const RECOMMENDATION_WEIGHTS = Object.freeze({
  courseMatch: 28,
  careerGoalAlignment: 12,
  evaluationPriorities: 12,
  learningStyleSignal: 8,
  budgetFit: 12,
  locationFit: 14,
  careerPrioritySignal: 8,
  parentConstraints: 6,
  concernMitigation: 8,
});

const TIER_LIMITS = Object.freeze({
  bestMatch: 1,
  strongAlternatives: 3,
  worthExploring: 3,
});

/** Stage 7 presents exactly five personalized shortlist options. */
const SHORTLIST_PRESENT_LIMIT = 5;

const MESSAGES = Object.freeze({
  shortlist_intro: [
    "Based on everything you've shared, I've shortlisted five colleges that align well with your goals.",
  ].join('\n'),

  shortlist_intro_predictor: [
    "Based on your rank and preferences, I've shortlisted five colleges that align well with your goals.",
  ].join('\n'),

  ask_exam: [
    'Which entrance exam?',
    '',
    'AP EAPCET, TS EAMCET, KCET, JEE Main…',
  ].join('\n'),

  ask_rank: 'What’s your rank (or expected rank)?',

  ask_category: [
    'Which category?',
    '',
    'OC, BCA–BCE, SC, ST — Boys/Girls if needed.',
  ].join('\n'),

  ask_region: 'For AP EAPCET — AU or SVU?',

  generating: 'Got it — building your personalized shortlist now…',

  generating_eligibility: 'Got it — fetching eligible colleges now…',

  no_eligibility: [
    'I could not retrieve eligible colleges with those details.',
    '',
    'Share a corrected exam/rank/category — or type MENU.',
  ].join('\n'),

  profile_incomplete: [
    'Your counseling profile needs a bit more first.',
    '',
    'Finish earlier steps, then we continue.',
  ].join('\n'),

  present_header:
    "Based on everything you've shared, I've shortlisted five colleges that align well with your goals.",

  best_match_header: '*Best Match*',
  strong_header: '*Strong Alternatives*',
  explore_header: '*Worth Exploring*',

  ask_compare: [
    'These are personalized matches based on what you shared — not a generic ranking.',
    'Would you like me to compare them side by side?',
  ].join('\n'),

  permission_clarify: 'Would you like to compare them side by side?\n\nReply Yes or No.',

  permission_no: [
    'No problem.',
    '',
    'Say yes whenever you want to compare.',
  ].join('\n'),

  permission_declined_reengage: 'Ready to compare? Just say yes.',

  comparison_placeholder: [
    'Detailed comparison is next.',
    '',
    'Coming soon — send a message when ready.',
  ].join('\n'),

  awaiting_ack_nudge: 'Take your time — or ask why a detail is needed.',

  greeting_mid: 'Hello again! Let’s continue your personalized shortlist.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  question_fallback:
    'Eligibility comes from predictor cutoffs. Personalization only reorders *eligible* options.',

  confidence_line: (score) => `Recommendation confidence: ${score}%.`,
});

const SHORTLIST_QA = Object.freeze([
  {
    patterns: [/\bhow (did|do) you (pick|choose|select|rank)/i, /\bwhy (these|this) college/i],
    answer:
      'Eligible colleges come from the predictor for your exam and rank. Then a recommendation matrix scores them using your stored profile — course, goals, priorities, budget, location, learning style, family constraints, and concerns — and explains each pick.',
  },
  {
    patterns: [/\beligib/i, /\bpredictor\b/i, /\bcutoff\b/i],
    answer:
      'Eligibility means the college-branch appears in cutoff data for your exam, rank band, and category. Personalization only reorders and explains within that eligible set.',
  },
]);

function getShortlistMessage(key, ...args) {
  const val = MESSAGES[key];
  if (typeof val === 'function') return val(...args);
  return val || '';
}

module.exports = {
  STAGES,
  SHORTLISTING_STEPS,
  RECOMMENDATION_MATRIX_VERSION,
  RECOMMENDATION_WEIGHTS,
  TIER_LIMITS,
  SHORTLIST_PRESENT_LIMIT,
  MESSAGES,
  SHORTLIST_QA,
  getShortlistMessage,
};
