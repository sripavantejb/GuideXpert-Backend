'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 2 College Selection Masterclass.
 * Educational evaluation framework (no recommendations).
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

const EVALUATION_STEPS = Object.freeze([
  'eval_transition',
  'eval_common_mistakes',
  'eval_framework',
  'eval_comparison',
  'eval_ask_priorities',
  'eval_knowledge_confirm',
  'eval_ask_permission',
]);

const EVALUATION_FACTORS = Object.freeze([
  Object.freeze({ id: 'curriculum', label: 'Curriculum relevance' }),
  Object.freeze({ id: 'projects', label: 'Practical / project-based learning' }),
  Object.freeze({ id: 'industry', label: 'Industry exposure & internships' }),
  Object.freeze({ id: 'placements', label: 'Placement preparation (not just claims)' }),
  Object.freeze({ id: 'mentoring', label: 'Career mentoring & guidance' }),
  Object.freeze({ id: 'faculty', label: 'Faculty quality & teaching approach' }),
  Object.freeze({ id: 'environment', label: 'Learning environment' }),
  Object.freeze({ id: 'brand', label: 'Brand / rankings' }),
  Object.freeze({ id: 'fees', label: 'Fees / affordability' }),
  Object.freeze({ id: 'location', label: 'Location / convenience' }),
]);

const MESSAGES = Object.freeze({
  personalized_transition: [
    'Before naming colleges, let’s learn how we’ll compare colleges.',
    '',
    'Ready?',
  ].join('\n'),

  common_mistakes: [
    'Common shortcuts students regret:',
    '',
    '✅ Friends are going there',
    '✅ Brand / rankings only',
    '✅ Nearby or cheapest only',
    '✅ Ads alone',
    '',
    'Sound familiar?',
  ].join('\n'),

  framework: [
    'How we’ll compare colleges:',
    '',
    '✅ Curriculum relevance',
    '✅ Projects',
    '✅ Internships',
    '✅ Placement prep',
    '',
    'Brand and fees matter too — just not alone.',
    '',
    'Ready for a quick example?',
  ].join('\n'),

  comparison_example: [
    'Fictional example (not a recommendation):',
    '',
    '*College A* — big brand, weak projects.',
    '',
    '*College B* — less famous, strong projects + mentoring.',
    '',
    'Fame alone isn’t a plan. Make sense?',
  ].join('\n'),

  ask_priorities: [
    'Which factors matter most to you?',
    '',
    'Projects, internships, mentoring, curriculum, placements…',
  ].join('\n'),

  knowledge_confirm: [
    'Clearer on how to evaluate colleges now?',
    '',
    'Reply yes — or ask anything.',
  ].join('\n'),

  ask_permission: [
    'Awesome.',
    '',
    'Would you like to continue?',
  ].join('\n'),

  permission_clarify: 'Continue to modern learning approaches?\n\nReply Yes or No.',

  permission_no: [
    'No problem.',
    '',
    'Say yes whenever you’re ready.',
  ].join('\n'),

  permission_declined_reengage: 'Ready to continue? Just say yes.',

  awaiting_ack_nudge: 'Take your time — or ask me anything.',

  greeting_mid_evaluation: 'Hello again! Let’s continue from where we left off.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  priorities_ack: 'Got it 👍',

  priorities_clarify:
    'What matters most — projects, internships, mentoring, placements, fees, or location?',

  question_fallback:
    'Look past marketing. Focus on projects, exposure, and mentoring. Rankings and brand are just one input.',

  mindset_shift_ack: 'Perfect — judge fit, not just fame.',
});

const EVALUATION_QA = Object.freeze([
  {
    patterns: [/\bplacement(s)?\b/i, /\bjob(s)? after college\b/i],
    answer:
      'Placements depend on preparation quality — projects, internships, and interview readiness — not brochure numbers alone. Ask how a college trains students, not only the final package list.',
  },
  {
    patterns: [/\branking(s)?\b/i, /\bnirf\b/i, /\bbrand\b/i, /\bfame\b/i],
    answer:
      'Rankings and brand can be a starting signal, but they rarely show teaching quality, project depth, or mentoring. Use them as one input — never the only one.',
  },
  {
    patterns: [/\bfees?\b/i, /\bcost\b/i, /\bexpensive\b/i, /\bafford/i],
    answer:
      'Fees matter for practicality, but a lower fee with weak learning can cost more later. Compare value — what skills and exposure you get for the investment.',
  },
  {
    patterns: [/\blocation\b/i, /\bnearby\b/i, /\bclose to home\b/i],
    answer:
      'Location is convenient, but convenience alone should not outweigh career preparation. Many students trade a short commute for long-term readiness.',
  },
  {
    patterns: [/\bcurriculum\b/i, /\bsyllabus\b/i],
    answer:
      'A strong curriculum stays updated with industry needs and connects theory to projects — not just exam chapters.',
  },
  {
    patterns: [/\binternship(s)?\b/i, /\bindustry\b/i],
    answer:
      'Internships and industry exposure show how workplaces actually function. Colleges that integrate them early usually build more confident graduates.',
  },
  {
    patterns: [/\bmentor(ing|ship)?\b/i, /\bguidance\b/i],
    answer:
      'Career mentoring helps you choose paths, prepare for roles, and avoid guessing alone. It is one of the most underrated evaluation factors.',
  },
  {
    patterns: [/\bfriend(s)?\b/i, /\bpeer pressure\b/i],
    answer:
      'Friends can influence you, but your career path is personal. What suits someone else may not match your goals or learning style.',
  },
]);

function getEvalMessage(key) {
  return MESSAGES[key] || '';
}

function getNextEvalStep(currentStep) {
  const idx = EVALUATION_STEPS.indexOf(currentStep);
  if (idx < 0 || idx >= EVALUATION_STEPS.length - 1) return null;
  return EVALUATION_STEPS[idx + 1];
}

function getEvalContentForStep(step) {
  switch (step) {
    case 'eval_transition':
      return getEvalMessage('personalized_transition');
    case 'eval_common_mistakes':
      return getEvalMessage('common_mistakes');
    case 'eval_framework':
      return getEvalMessage('framework');
    case 'eval_comparison':
      return getEvalMessage('comparison_example');
    case 'eval_ask_priorities':
      return getEvalMessage('ask_priorities');
    case 'eval_knowledge_confirm':
      return getEvalMessage('knowledge_confirm');
    case 'eval_ask_permission':
      return getEvalMessage('ask_permission');
    case 'eval_permission_declined':
      return getEvalMessage('permission_no');
    default:
      return '';
  }
}

function buildPersonalizedTransition(profile = {}) {
  const bits = [];
  if (profile.preferredCourse) bits.push(`your interest in ${profile.preferredCourse}`);
  if (profile.careerGoal) bits.push(`your goal around "${String(profile.careerGoal).slice(0, 80)}"`);
  if (Array.isArray(profile.preferredColleges) && profile.preferredColleges.length > 0) {
    bits.push(`the colleges you already mentioned`);
  }

  if (bits.length === 0) {
    return getEvalMessage('personalized_transition');
  }

  const personal = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;

  return [
    `Thanks for sharing your profile — especially ${personal}.`,
    '',
    'Before we talk about any specific college, I want to show you how experienced counsellors *evaluate* options.',
    '',
    'That way you can judge any college with confidence — not only by brand, fees, or location.',
    '',
    'Shall we walk through that framework together? Reply when you are ready.',
  ].join('\n');
}

module.exports = {
  STAGES,
  EVALUATION_STEPS,
  EVALUATION_FACTORS,
  MESSAGES,
  EVALUATION_QA,
  getEvalMessage,
  getNextEvalStep,
  getEvalContentForStep,
  buildPersonalizedTransition,
};
