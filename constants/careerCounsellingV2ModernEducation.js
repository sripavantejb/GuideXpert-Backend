'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 3 Modern Education Discovery.
 * Educational only — no institution names or recommendations.
 */

const STAGES = Object.freeze({
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

const MODERN_EDUCATION_STEPS = Object.freeze([
  'modern_transition',
  'modern_what_is',
  'modern_traditional_vs',
  'modern_industry_learning',
  'modern_student_story',
  'modern_ask_learning_style',
  'modern_knowledge_summary',
  'modern_ask_permission',
]);

const LEARNING_STYLES = Object.freeze([
  Object.freeze({ id: 'hands_on', label: 'Hands-on / project-based' }),
  Object.freeze({ id: 'industry_aligned', label: 'Industry-aligned with internships' }),
  Object.freeze({ id: 'balanced', label: 'Balanced theory + practice' }),
  Object.freeze({ id: 'theory_first', label: 'Theory-first / traditional' }),
  Object.freeze({ id: 'mentored', label: 'Mentored / guided learning' }),
  Object.freeze({ id: 'exploring', label: 'Still exploring' }),
]);

const MESSAGES = Object.freeze({
  personalized_transition: [
    'Next — how modern learning works.',
    '',
    'Still no college names. Ready?',
  ].join('\n'),

  what_is_modern: [
    '“Modern” / future-ready learning usually means:',
    '',
    '✅ Projects',
    '✅ Real skills',
    '✅ Industry exposure',
    '',
    'It does *not* mean traditional is always wrong.',
    '',
    'Make sense?',
  ].join('\n'),

  traditional_vs_modern: [
    '*Traditional focus*',
    '✅ Syllabus + exams',
    '✅ Theory first',
    '',
    '*Modern focus*',
    '✅ Projects + portfolio',
    '✅ Internships + mentoring',
    '',
    'Many good programmes blend both.',
  ].join('\n'),

  industry_learning: [
    'Industry learning often includes:',
    '',
    '✅ Internships',
    '✅ Real projects',
    '✅ Portfolio',
    '✅ Mentoring',
    '',
    'Ready for a short fictional story?',
  ].join('\n'),

  student_story: [
    'Fictional example:',
    '',
    'Same stream. One studied for exams only. The other also built projects + did an internship.',
    '',
    'The second found it easier to show what they can *do*.',
    '',
    'Does this resonate?',
  ].join('\n'),

  ask_learning_style: [
    'What learning style fits you?',
    '',
    'Hands-on, internships, balanced, theory-first, or still exploring?',
  ].join('\n'),

  knowledge_summary: [
    'Quick recap:',
    '',
    '✅ Fit matters more than labels',
    '✅ Projects + exposure help',
    '✅ Your learning style is clearer now',
  ].join('\n'),

  ask_permission: [
    'Next: a few practical preferences.',
    '',
    'Would you like to continue?',
  ].join('\n'),

  permission_clarify:
    'Continue to career priorities, location, and budget?\n\nReply Yes or No.',

  permission_no: [
    'No problem.',
    '',
    'Say yes whenever you’re ready.',
  ].join('\n'),

  permission_declined_reengage: 'Ready to continue? Just say yes.',

  awaiting_ack_nudge: 'Take your time — or ask me anything.',

  greeting_mid_modern: 'Hello again! Let’s continue from where we left off.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  learning_style_ack: 'Got it 👍',

  learning_style_clarify:
    'Hands-on, internships, balanced, theory-first, mentored — or still exploring?',

  question_fallback:
    'Not automatically “modern = better.” Pick the mix that fits you — projects, foundations, or both.',

  modern_complete_ack: 'Nice! Learning style is clearer now.',
});

const MODERN_EDUCATION_QA = Object.freeze([
  {
    patterns: [/\bmodern (always|better|best)\b/i, /\bis modern better\b/i],
    answer:
      'Not automatically. Modern approaches can help with skills and exposure, but traditional strengths (foundations, discipline, strong faculty) still matter. Fit to your goals is what counts.',
  },
  {
    patterns: [/\btraditional\b/i, /\bold (style|way)\b/i],
    answer:
      'Traditional approaches often build strong fundamentals and exam discipline. Many students do well with that base — especially when they also add projects or internships on their own.',
  },
  {
    patterns: [/\bproject(s)?\b/i, /\bportfolio\b/i],
    answer:
      'Projects and portfolios help you show what you can build or solve — which employers often look for beyond marks alone.',
  },
  {
    patterns: [/\binternship(s)?\b/i, /\bindustry\b/i],
    answer:
      'Internships and industry exposure give a feel for real workplaces. They complement classroom learning; they do not replace a solid academic foundation.',
  },
  {
    patterns: [/\bai\b/i, /\bfuture skill(s)?\b/i, /\bemerging\b/i],
    answer:
      'Future skills (including tools like AI) change quickly. Programmes that refresh curriculum and let you practise on real problems help you keep up — whichever label they use.',
  },
  {
    patterns: [/\bwhich college\b/i, /\brecommend\b/i, /\bsuggest (a |some )?college\b/i],
    answer:
      'We are not naming or recommending colleges in this step. First we clarify the learning approach that fits you — shortlisting comes later.',
  },
]);

function getModernMessage(key) {
  return MESSAGES[key] || '';
}

function getNextModernStep(currentStep) {
  const idx = MODERN_EDUCATION_STEPS.indexOf(currentStep);
  if (idx < 0 || idx >= MODERN_EDUCATION_STEPS.length - 1) return null;
  return MODERN_EDUCATION_STEPS[idx + 1];
}

function getModernContentForStep(step) {
  switch (step) {
    case 'modern_transition':
      return getModernMessage('personalized_transition');
    case 'modern_what_is':
      return getModernMessage('what_is_modern');
    case 'modern_traditional_vs':
      return getModernMessage('traditional_vs_modern');
    case 'modern_industry_learning':
      return getModernMessage('industry_learning');
    case 'modern_student_story':
      return getModernMessage('student_story');
    case 'modern_ask_learning_style':
      return getModernMessage('ask_learning_style');
    case 'modern_knowledge_summary':
      return getModernMessage('knowledge_summary');
    case 'modern_ask_permission':
      return getModernMessage('ask_permission');
    case 'modern_permission_declined':
      return getModernMessage('permission_no');
    default:
      return '';
  }
}

function buildPersonalizedModernTransition(profile = {}) {
  const bits = [];
  if (Array.isArray(profile.studentPriorities) && profile.studentPriorities.length > 0) {
    bits.push(`your focus on ${profile.studentPriorities.slice(0, 3).join(', ')}`);
  } else if (Array.isArray(profile.evaluationPriorities) && profile.evaluationPriorities.length > 0) {
    bits.push('the evaluation factors you chose');
  }
  if (profile.preferredCourse) bits.push(`your interest in ${profile.preferredCourse}`);
  if (profile.careerGoal) bits.push(`your career direction`);

  if (bits.length === 0) {
    return getModernMessage('personalized_transition');
  }

  const personal = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;

  return [
    `Given ${personal}, the next useful step is understanding *how* learning approaches differ — traditional foundations versus more industry-aligned, project-heavy models.`,
    '',
    'We still will not name colleges here. The goal is curiosity and clarity about future-ready education.',
    '',
    'Ready to explore that? Reply when you are ready.',
  ].join('\n');
}

module.exports = {
  STAGES,
  MODERN_EDUCATION_STEPS,
  LEARNING_STYLES,
  MESSAGES,
  MODERN_EDUCATION_QA,
  getModernMessage,
  getNextModernStep,
  getModernContentForStep,
  buildPersonalizedModernTransition,
};
