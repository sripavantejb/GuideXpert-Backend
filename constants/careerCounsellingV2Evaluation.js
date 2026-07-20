'use strict';

/**
 * GuideXpert V2 Career Counselling — Roadmap Phase 3 Interactive Framework.
 * Discover priorities → validate + counselor expertise → permission (no lecture chain).
 */

const STAGES = Object.freeze({
  EVALUATION_FRAMEWORK: 'evaluation_framework',
  MODERN_COLLEGES: 'modern_colleges',
  PERSONALIZED_DISCOVERY: 'personalized_discovery',
  PERSONALIZED_SHORTLISTING: 'personalized_shortlisting',
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
  COMPARISON_PLACEHOLDER: 'comparison_placeholder',
});

/** Interactive flow steps (legacy teaching steps kept for resume redirect). */
const EVALUATION_STEPS = Object.freeze([
  'eval_ask_priorities',
  'eval_ask_permission',
  'eval_transition',
  'eval_common_mistakes',
  'eval_framework',
  'eval_comparison',
  'eval_knowledge_confirm',
]);

const EVALUATION_FACTORS = Object.freeze([
  Object.freeze({ id: 'placements', label: 'Placements' }),
  Object.freeze({ id: 'projects', label: 'Coding Culture' }),
  Object.freeze({ id: 'industry', label: 'Internships' }),
  Object.freeze({ id: 'fees', label: 'Affordable Fees' }),
  Object.freeze({ id: 'environment', label: 'Campus Life' }),
  Object.freeze({ id: 'curriculum', label: 'Research' }),
  Object.freeze({ id: 'entrepreneurship', label: 'Entrepreneurship' }),
  Object.freeze({ id: 'higher_studies', label: 'Higher Studies' }),
  Object.freeze({ id: 'location', label: 'Location' }),
  Object.freeze({ id: 'mentoring', label: 'Mentorship' }),
  Object.freeze({ id: 'faculty', label: 'Faculty' }),
  Object.freeze({ id: 'brand', label: 'Brand / Rankings' }),
]);

const COUNSELOR_SUGGESTED_PRIORITIES = Object.freeze([
  Object.freeze({ id: 'placements', label: 'Placements' }),
  Object.freeze({ id: 'projects', label: 'Coding Culture' }),
  Object.freeze({ id: 'industry', label: 'Internships' }),
]);

const ADDITIONAL_FRAMEWORK_FACTORS = Object.freeze([
  '📘 Industry-relevant curriculum',
  '👨‍🏫 Faculty & mentorship',
  '💼 Live projects & internship exposure',
  '🤝 Alumni network',
  '🚀 Startup & innovation ecosystem',
]);

const MESSAGES = Object.freeze({
  ask_priorities: [
    "Before I recommend any colleges, I'd like to understand what matters most to you.",
    '',
    "What are the top things you're looking for in a college?",
    '',
    'For example:',
    '• Placements',
    '• Coding Culture',
    '• Internships',
    '• Affordable Fees',
    '• Campus Life',
    '• Research',
    '• Entrepreneurship',
    '• Higher Studies',
    '• Location',
  ].join('\n'),

  priorities_clarify: [
    "Share what matters in your own words — placements, coding culture, fees, location, or anything else.",
    "Or say \"I don't know\" / \"You suggest\" and I'll propose a starting framework.",
  ].join('\n'),

  permission_clarify:
    'Would you like me to shortlist some colleges that best match this framework?\n\nReply Yes or No.',

  permission_no: [
    'No problem — we can refine your priorities first.',
    'Tell me what else matters, or say yes when you want college options.',
  ].join('\n'),

  permission_declined_reengage:
    'Ready for colleges that match your framework? Just say yes.',

  awaiting_ack_nudge: 'Take your time — share what matters most in a college.',

  greeting_mid_evaluation: 'Hello again! Let’s continue from where we left off.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  question_fallback: [
    'Your priorities guide the shortlist — rankings are only one input.',
    'Share what matters most, or say yes to see matching colleges.',
  ].join('\n'),

  // Legacy keys retained so old helpers/certs do not crash
  personalized_transition: '',
  common_mistakes: '',
  framework: '',
  comparison_example: '',
  knowledge_confirm: '',
  ask_permission: '',
  priorities_ack: 'Great! That’s a strong starting point.',
  mindset_shift_ack: 'Perfect — we’ll use the framework we built together.',
});

/**
 * Build the single acknowledge + expand + permission message.
 */
function buildFrameworkExpandMessage(profile = {}) {
  const priorities = Array.isArray(profile.studentPriorities)
    ? profile.studentPriorities.filter(Boolean)
    : [];
  const shown = priorities.length ? priorities : COUNSELOR_SUGGESTED_PRIORITIES.map((p) => p.label);

  const lines = [
    'Great! That’s a strong starting point.',
    '',
    '*Your Priorities*',
    '',
    ...shown.map((p) => `✅ ${p}`),
    '',
    '---',
    '',
    "*Additional Factors I'll Evaluate*",
    '',
    'As your AI Career Counselor, I’ll also consider:',
    '',
    ...ADDITIONAL_FRAMEWORK_FACTORS,
    '',
    'Together, these give us a complete framework to identify colleges that truly fit your career goals—not just their rankings.',
    '',
    'Would you like me to shortlist some colleges that best match this framework?',
  ];
  return lines.join('\n');
}

const EVALUATION_QA = Object.freeze([
  {
    patterns: [/\bplacement(s)?\b/i, /\bjob(s)? after college\b/i],
    answer:
      'Placements are one strong signal — preparation quality still matters. Want placements in your top priorities?',
  },
  {
    patterns: [/\branking(s)?\b/i, /\bnirf\b/i, /\bbrand\b/i],
    answer:
      'Brand helps as a clue, not the whole decision. Shall we keep it as one factor beside your other priorities?',
  },
  {
    patterns: [/\bfees?\b/i, /\bafford/i],
    answer:
      'Affordable fees keep options practical for your family. Want that as a top priority?',
  },
]);

function getEvalMessage(key) {
  return MESSAGES[key] || '';
}

function getNextEvalStep(currentStep) {
  const interactive = ['eval_ask_priorities', 'eval_ask_permission'];
  const idx = interactive.indexOf(currentStep);
  if (idx < 0 || idx >= interactive.length - 1) return null;
  return interactive[idx + 1];
}

function getEvalContentForStep(step) {
  switch (step) {
    case 'eval_ask_priorities':
    case 'eval_transition':
    case 'eval_common_mistakes':
    case 'eval_framework':
    case 'eval_comparison':
    case 'eval_knowledge_confirm':
      return getEvalMessage('ask_priorities');
    case 'eval_ask_permission':
      return getEvalMessage('permission_clarify');
    case 'eval_permission_declined':
      return getEvalMessage('permission_no');
    default:
      return getEvalMessage('ask_priorities');
  }
}

function buildPersonalizedTransition() {
  return getEvalMessage('ask_priorities');
}

module.exports = {
  STAGES,
  EVALUATION_STEPS,
  EVALUATION_FACTORS,
  COUNSELOR_SUGGESTED_PRIORITIES,
  ADDITIONAL_FRAMEWORK_FACTORS,
  MESSAGES,
  EVALUATION_QA,
  getEvalMessage,
  getNextEvalStep,
  getEvalContentForStep,
  buildPersonalizedTransition,
  buildFrameworkExpandMessage,
};
