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
  'compare_ask_recommendation',
]);

const COMPARISON_ENGINE_VERSION = 'v1.1.0';

/** Max colleges a student can compare in one turn. */
const MAX_COMPARE_COLLEGES = 5;
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
  Object.freeze({
    id: 'ai_focus',
    label: 'AI focus',
    profileKeys: ['careerGoal', 'careerPriority', 'preferredCourse'],
  }),
  Object.freeze({
    id: 'industry_projects',
    label: 'Industry projects',
    profileKeys: ['careerPriority', 'evaluationPriorities'],
  }),
  Object.freeze({
    id: 'mentorship',
    label: 'Mentorship',
    profileKeys: ['studentPriorities', 'evaluationPriorities'],
  }),
  Object.freeze({
    id: 'internships',
    label: 'Internships',
    profileKeys: ['careerGoal', 'careerPriority'],
  }),
  Object.freeze({
    id: 'career_support',
    label: 'Career support',
    profileKeys: ['careerPriority', 'careerGoal'],
  }),
  Object.freeze({
    id: 'portfolio',
    label: 'Portfolio development',
    profileKeys: ['careerGoal', 'studentPriorities'],
  }),
  Object.freeze({
    id: 'innovation',
    label: 'Innovation',
    profileKeys: ['careerGoal', 'studentPriorities'],
  }),
  Object.freeze({
    id: 'student_experience',
    label: 'Student experience',
    profileKeys: ['preferredLearningStyle', 'studentPriorities'],
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

  ask_recommendation:
    "Would you like me to suggest which college appears to be the best fit based on everything you've shared?",

  continue_clarify:
    "Would you like me to suggest which college appears to be the best fit based on everything you've shared?\n\nReply Yes or No.",

  greeting_mid: 'Hello again! Let’s continue your comparison.',

  awaiting_ack_nudge: 'Reply Yes for best-fit guidance, or ask a specific concern/question.',

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
