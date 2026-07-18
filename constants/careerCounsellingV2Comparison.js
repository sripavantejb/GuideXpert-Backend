'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 6 Smart Comparison & Decision Support.
 * Personalized, evidence-based comparison of shortlisted colleges only.
 */

const STAGES = Object.freeze({
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
});

const COMPARISON_STEPS = Object.freeze([
  'compare_select',
  'compare_present',
  'compare_invite_questions',
  'compare_ask_continue',
]);

const COMPARISON_ENGINE_VERSION = 'v1.0.0';

/** Max colleges a student can compare in one turn. */
const MAX_COMPARE_COLLEGES = 3;
const MIN_COMPARE_COLLEGES = 2;

/**
 * Comparison dimensions. Only dimensions relevant to the stored profile are used.
 */
const COMPARISON_DIMENSIONS = Object.freeze([
  Object.freeze({
    id: 'course_fit',
    label: 'Course / branch fit',
    profileKeys: ['preferredCourse'],
  }),
  Object.freeze({
    id: 'career_goal',
    label: 'Career goal alignment',
    profileKeys: ['careerGoal'],
  }),
  Object.freeze({
    id: 'career_priority',
    label: 'Career priority',
    profileKeys: ['careerPriority'],
  }),
  Object.freeze({
    id: 'learning_style',
    label: 'Learning style fit',
    profileKeys: ['preferredLearningStyle'],
  }),
  Object.freeze({
    id: 'budget',
    label: 'Budget / fees',
    profileKeys: ['budgetPreference', 'financialPreference'],
    concernIds: ['fees'],
  }),
  Object.freeze({
    id: 'location',
    label: 'Location / relocation',
    profileKeys: ['preferredLocation', 'relocationPreference'],
    concernIds: ['location'],
  }),
  Object.freeze({
    id: 'family',
    label: 'Family / parent preferences',
    profileKeys: ['parentPreferences', 'familyConstraints'],
  }),
  Object.freeze({
    id: 'evaluation_priorities',
    label: 'Your evaluation priorities',
    profileKeys: ['evaluationPriorities', 'studentPriorities'],
  }),
  Object.freeze({
    id: 'concerns',
    label: 'Your stated concerns',
    profileKeys: ['biggestConcerns'],
  }),
]);

const MESSAGES = Object.freeze({
  compare_intro: [
    'Let’s compare options from your shortlist.',
    '',
    'We’ll use *your* priorities — not a generic ranking.',
  ].join('\n'),

  ask_select: [
    'Which colleges should we compare?',
    '',
    'Reply 1 and 2, names, or “first two”.',
    '',
    'Pick 2 or 3.',
  ].join('\n'),

  select_clarify: 'Please choose 2 or 3 colleges (number or name).',

  no_shortlist: [
    'No shortlist saved yet.',
    '',
    'Finish shortlisting first — or type MENU.',
  ].join('\n'),

  comparison_header: 'Your personalized comparison:',

  dimensions_header: '*What we’re comparing:*',

  tradeoffs_header: '*Trade-offs*',

  verdict_header: '*Personalized Verdict*',

  invite_questions: [
    'Any question — fees, location, branch fit?',
    '',
    'Or reply *Continue*.',
  ].join('\n'),

  question_fallback: [
    'I can only compare your shortlisted options.',
    '',
    'Ask about fit/fees/location — or say Continue.',
  ].join('\n'),

  ask_continue: [
    'Ready for the next step?',
    '',
    'Reply Yes — or ask another question.',
  ].join('\n'),

  continue_clarify: 'Reply Yes to move ahead, or ask another comparison question.',

  concern_resolution_placeholder: [
    'Next we’ll clear remaining worries.',
    '',
    'Coming soon — send a message when ready.',
  ].join('\n'),

  greeting_mid: 'Hello again! Let’s continue your comparison.',

  awaiting_ack_nudge: 'Pick colleges, ask a question, or say Continue.',

  resume_checkpoint_prefix: 'Coming back to where we were —',
});

const COMPARE_QA = Object.freeze([
  {
    patterns: [/\bhow (did|do) you compare\b/i, /\bwhy (this|these) (verdict|choice|college)/i],
    answer:
      'The comparison uses only colleges from your shortlist, then checks dimensions that match your stored profile — course, goals, priorities, budget, location, family preferences, and concerns — and explains each side with evidence from that profile.',
  },
  {
    patterns: [/\bdecision confidence\b/i, /\bhow sure\b/i],
    answer:
      'Decision confidence is calculated internally from profile completeness and how clearly one option fits your priorities. It guides the verdict quality — it is not shown as a public ranking score.',
  },
]);

function getCompareMessage(key, ...args) {
  const val = MESSAGES[key];
  if (typeof val === 'function') return val(...args);
  return val || '';
}

module.exports = {
  STAGES,
  COMPARISON_STEPS,
  COMPARISON_ENGINE_VERSION,
  MAX_COMPARE_COLLEGES,
  MIN_COMPARE_COLLEGES,
  COMPARISON_DIMENSIONS,
  MESSAGES,
  COMPARE_QA,
  getCompareMessage,
};
