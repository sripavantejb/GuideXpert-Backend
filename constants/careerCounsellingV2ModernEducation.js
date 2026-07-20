'use strict';

/**
 * GuideXpert V2 Career Counselling — Roadmap Phase 4 Modern Education Discovery.
 * Educational only — no institution names or recommendations.
 * Counselor-style explanations: idea → why → example → transition.
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
    'Next, let’s understand how education itself is changing.',
    'This is not about rejecting traditional colleges — many still build strong foundations.',
    'It is about noticing what employers and workplaces increasingly look for.',
    'We still will not name colleges here; clarity comes first.',
    'That clarity usually prevents brand-only decisions later.',
    'Ready to explore that?',
  ].join('\n'),

  what_is_modern: [
    '“Modern” or future-ready learning usually means practice sits beside theory.',
    'Students build skills they can show — through projects, tools, and real exposure.',
    'Traditional strengths still matter: discipline, fundamentals, and good teaching.',
    'Modern does not mean traditional is wrong; it means the mix is shifting.',
    'Imagine studying a subject and also shipping a small real project in the same semester.',
    'That combination often builds confidence faster than notes alone.',
    'Does that definition make sense so far?',
  ].join('\n'),

  traditional_vs_modern: [
    'A simple way to see the shift is what each approach optimizes for.',
    'Traditional focus often centers syllabus coverage and exam performance — foundations that still help.',
    'Modern focus adds projects, portfolios, internships, and mentoring beside those foundations.',
    'Many strong programmes blend both instead of choosing one extreme.',
    'Think of marks as proof you studied; a portfolio as proof you can apply what you studied.',
    'Neither replaces the other when the mix is healthy.',
    'Shall we look at how industry learning fits into this?',
  ].join('\n'),

  industry_learning: [
    'Industry learning is how campuses connect classrooms to real workplaces.',
    'Internships, live projects, and mentoring give you deadlines, teamwork, and tools beyond textbooks.',
    'That matters because employers often ask what you have built or solved — not only what you scored.',
    'A short internship can clarify whether a career path fits you before you commit years to it.',
    'Think of it as a rehearsal for work while you are still studying.',
    'Ready for a short fictional student story?',
  ].join('\n'),

  student_story: [
    'Imagine two students with the same degree.',
    'One completed only classroom assignments and exams.',
    'The other also built real projects and completed an internship.',
    'Employers usually notice the second student’s experience much earlier.',
    'Same qualification — different evidence of readiness.',
    'Does this resonate with how you want to learn?',
  ].join('\n'),

  ask_learning_style: [
    'Your learning style shapes which college environment will feel right.',
    'Some students thrive hands-on; others need strong theory first; many want a balance.',
    'Internships, mentoring, or still exploring are all honest answers.',
    'There is no wrong preference — only a clearer fit.',
    'Naming it now helps us match programmes that support how you learn best.',
    'What learning style fits you best right now?',
  ].join('\n'),

  knowledge_summary: [
    'Quick recap of what you have learned.',
    'Fit matters more than labels like “traditional” or “modern.”',
    'Projects, exposure, and your learning style help you choose with less regret.',
    'Traditional foundations and modern practice can work together.',
    'That balance is what most confident students eventually look for.',
    'Shall we continue into a few practical preferences next?',
  ].join('\n'),

  ask_permission: [
    'Next: a few practical preferences — career priority, location, budget, and family view.',
    'That helps us personalize options without guessing.',
    'Would you like to continue?',
  ].join('\n'),

  permission_clarify:
    'Continue to career priorities, location, and budget?\n\nReply Yes or No.',

  permission_no: [
    'No problem.',
    'Say yes whenever you’re ready.',
  ].join('\n'),

  permission_declined_reengage: 'Ready to continue? Just say yes.',

  awaiting_ack_nudge: 'Take your time — or ask me anything about modern vs traditional learning.',

  greeting_mid_modern: 'Hello again! Let’s continue from where we left off.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  learning_style_ack: 'Got it — that learning preference helps us match the right environment.',

  learning_style_clarify:
    'Hands-on, internships, balanced, theory-first, mentored — or still exploring?',

  question_fallback: [
    'Modern is not automatically better.',
    'Pick the mix that fits you — projects, foundations, or both.',
    'Want to share which learning style feels closest?',
  ].join('\n'),

  modern_complete_ack: 'Nice — your learning style is clearer now.',
});

const MODERN_EDUCATION_QA = Object.freeze([
  {
    patterns: [/\bmodern (always|better|best)\b/i, /\bis modern better\b/i],
    answer: [
      'Not automatically.',
      'Modern approaches can help with skills and exposure, but traditional strengths still matter.',
      'Strong foundations and discipline remain valuable for many careers.',
      'Fit to your goals is what counts — not the label.',
      'Want to clarify which mix fits you?',
    ].join('\n'),
  },
  {
    patterns: [/\btraditional\b/i, /\bold (style|way)\b/i],
    answer: [
      'Traditional approaches often build strong fundamentals and exam discipline.',
      'Many students do well with that base — especially when they also add projects or internships.',
      'We are not criticizing traditional colleges; we are widening how you evaluate them.',
      'The best path is often a healthy blend.',
      'Shall we keep exploring what balance you prefer?',
    ].join('\n'),
  },
  {
    patterns: [/\bproject(s)?\b/i, /\bportfolio\b/i],
    answer: [
      'Projects and portfolios help you show what you can build or solve.',
      'Marks prove you studied; a portfolio proves you can apply learning.',
      'Employers often look for that evidence beyond marks alone.',
      'Even one strong project can change how interviews feel.',
      'Want projects to be part of your learning preference?',
    ].join('\n'),
  },
  {
    patterns: [/\binternship(s)?\b/i, /\bindustry\b/i],
    answer: [
      'Internships and industry exposure give a feel for real workplaces.',
      'They complement classroom learning; they do not replace a solid academic foundation.',
      'A short real stint can confirm or change your career direction early.',
      'That clarity matters because textbooks alone rarely show day-to-day work.',
      'Shall we keep industry learning in focus?',
    ].join('\n'),
  },
  {
    patterns: [/\bai\b/i, /\bfuture skill(s)?\b/i, /\bemerging\b/i],
    answer: [
      'Future skills — including tools like AI — change quickly.',
      'Programmes that refresh curriculum and let you practise on real problems help you keep up.',
      'The label on the college matters less than whether you get that practice.',
      'Curiosity plus applied learning usually ages better than memorizing one tool.',
      'Want to talk about which learning style supports that for you?',
    ].join('\n'),
  },
  {
    patterns: [/\bwhich college\b/i, /\brecommend\b/i, /\bsuggest (a |some )?college\b/i],
    answer: [
      'We are not naming or recommending colleges in this step.',
      'First we clarify the learning approach that fits you — shortlisting comes later.',
      'That order prevents random brand-chasing.',
      'Clarity now makes recommendations more useful later.',
      'Ready to share your learning style preference?',
    ].join('\n'),
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
  if (profile.careerGoal) bits.push('your career direction');

  if (bits.length === 0) {
    return getModernMessage('personalized_transition');
  }

  const personal =
    bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;

  return [
    `Given ${personal}, the next useful step is understanding how learning approaches differ.`,
    'We will look at traditional foundations beside more project-heavy, industry-aligned models.',
    'We still will not name colleges here — curiosity and clarity come first.',
    'This helps you notice what kind of environment will fit you.',
    'That clarity usually prevents brand-only decisions later.',
    'Ready to explore that?',
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
