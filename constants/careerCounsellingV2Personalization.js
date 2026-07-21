'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 4 Personalized Discovery.
 * Completes counseling profile before Phase 5 AI shortlisting.
 */

const STAGES = Object.freeze({
  PERSONALIZED_DISCOVERY: 'personalized_discovery',
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

const PERSONALIZATION_STEPS = Object.freeze([
  'pers_transition',
  'pers_career_priority',
  'pers_location',
  'pers_budget',
  'pers_family',
  'pers_concern',
  'pers_summary',
  'pers_clarify',
  'pers_ask_permission',
]);

const MESSAGES = Object.freeze({
  personalized_transition: [
    'Great — now let’s personalize so the shortlist fits you, not just the framework.',
    '',
    'I’ll ask a few quick questions: career focus, city, budget, family view, and concerns.',
    '',
    'Ready?',
  ].join('\n'),

  ask_career_priority: [
    'What matters most in your career right now?',
    '',
    'Placements, skills, startups, research…',
    '',
    '*Why I ask:* it shapes your best matches later.',
  ].join('\n'),

  ask_location: [
    'Where do you prefer to study?',
    '',
    'City/state, open to relocate, hostel needed?',
    '',
    '*Why I ask:* location changes what’s realistic.',
  ].join('\n'),

  ask_budget: [
    "What's your approximate budget?",
    '',
    'A ballpark is fine — loan/scholarship ok too.',
    '',
    '*Why I ask:* keeps options practical.',
  ].join('\n'),

  ask_family: [
    'What do parents/family prefer?',
    '',
    'Nearby, brand, stream, or they support your choice?',
    '',
    '*Why I ask:* family often shapes the final call.',
  ].join('\n'),

  ask_concern: [
    'Biggest concern right now?',
    '',
    'Fees, wrong branch, confusion, placements…',
    '',
    '*Why I ask:* we’ll clear worries before shortlisting.',
  ].join('\n'),

  summary_header: 'Your counseling profile so far:',

  confidence_high: [
    'Counseling confidence looks strong.',
    '',
    'Would you like to continue to best matches?',
  ].join('\n'),

  confidence_medium: 'Almost there — one detail will help.',

  confidence_low: 'A bit more detail will help before we move on.',

  clarify_career: 'Top priority — placements, skills, research, or something else?',

  clarify_location: 'Preferred city + relocating / hostel?',

  clarify_budget: 'Rough fee range or funding plan?',

  clarify_family: 'What do family mainly prefer or worry about?',

  clarify_concern: 'What worries you most — fees, branch, placements?',

  ask_permission: [
    'Ready for personalized shortlisting?',
    '',
    'Would you like to continue?',
  ].join('\n'),

  permission_clarify: 'Continue to shortlisting?\n\nReply Yes or No.',

  permission_no: [
    'No problem.',
    '',
    'Say yes whenever you’re ready.',
  ].join('\n'),

  permission_declined_reengage: 'Ready for shortlisting? Just say yes.',

  ai_shortlisting_placeholder: [
    'Shortlisting is next.',
    '',
    'Coming soon — send a message when ready.',
  ].join('\n'),

  awaiting_ack_nudge: 'Take your time — or ask why a question matters.',

  greeting_mid: 'Hello again! Let’s continue your counseling profile.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  ack_career: 'Got it 👍',
  ack_location: 'Perfect.',
  ack_budget: 'Noted.',
  ack_family: 'Makes sense.',
  ack_concern: 'Thanks for sharing.',

  clarify_generic: 'Could you share a bit more?',

  question_fallback:
    'These questions fill your counseling profile — so later guidance fits *you*. Still no college pitches here.',
});

const PERSONALIZATION_QA = Object.freeze([
  {
    patterns: [/\bwhy (do you|are you) ask/i, /\bwhy this question\b/i],
    answer:
      'Each question fills a gap in your counseling profile — so later guidance can respect your priorities, constraints, and concerns. We are still not recommending colleges here.',
  },
  {
    patterns: [/\bbudget\b/i, /\bfees?\b/i, /\bcost\b/i],
    answer:
      'Budget is not about judging affordability — it is about keeping options realistic and reducing later stress.',
  },
  {
    patterns: [/\bparent\b/i, /\bfamily\b/i],
    answer:
      'Family preferences often shape final decisions. Capturing them early avoids conflict later and helps you plan conversations at home.',
  },
  {
    patterns: [/\brecommend\b/i, /\bwhich college\b/i, /\bshortlist\b/i],
    answer:
      'We are completing your profile first. Shortlisting comes in a later stage — this step stays focused on your priorities and constraints.',
  },
]);

function getPersMessage(key) {
  return MESSAGES[key] || '';
}

/** Default Stage 6 order after Ready? gate. */
const PERS_STEP_ORDER_DEFAULT = Object.freeze([
  'pers_transition',
  'pers_career_priority',
  'pers_location',
  'pers_budget',
  'pers_family',
  'pers_concern',
]);

/**
 * Stage 5 preview handoff starts at budget, then backfills remaining slots.
 * Used when profile.stage5PreviewInstitutions is set (unified normal path).
 */
const PERS_STEP_ORDER_FROM_EXPLORE = Object.freeze([
  'pers_budget',
  'pers_location',
  'pers_career_priority',
  'pers_family',
  'pers_concern',
]);

function getPersStepOrder(profile = {}) {
  if (
    Array.isArray(profile.stage5PreviewInstitutions) &&
    profile.stage5PreviewInstitutions.length > 0
  ) {
    return PERS_STEP_ORDER_FROM_EXPLORE;
  }
  return PERS_STEP_ORDER_DEFAULT;
}

function getNextPersStep(currentStep, profile = {}) {
  const order = getPersStepOrder(profile);
  const idx = order.indexOf(currentStep);
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

function getPersContentForStep(step) {
  switch (step) {
    case 'pers_transition':
      return getPersMessage('personalized_transition');
    case 'pers_career_priority':
      return getPersMessage('ask_career_priority');
    case 'pers_location':
      return getPersMessage('ask_location');
    case 'pers_budget':
      return getPersMessage('ask_budget');
    case 'pers_family':
      return getPersMessage('ask_family');
    case 'pers_concern':
      return getPersMessage('ask_concern');
    case 'pers_ask_permission':
      return getPersMessage('ask_permission');
    case 'pers_permission_declined':
      return getPersMessage('permission_no');
    case 'ai_shortlisting_placeholder':
      return getPersMessage('ai_shortlisting_placeholder');
    default:
      return '';
  }
}

function buildPersonalizedPersTransition(profile = {}) {
  const bits = [];
  if (profile.preferredCourse) bits.push(`your interest in ${profile.preferredCourse}`);
  if (profile.preferredLearningStyle) bits.push('your preferred learning style');
  if (Array.isArray(profile.studentPriorities) && profile.studentPriorities.length > 0) {
    bits.push(`evaluation priorities like ${profile.studentPriorities.slice(0, 2).join(' and ')}`);
  }

  if (bits.length === 0) {
    return getPersMessage('personalized_transition');
  }

  const personal = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;

  return [
    `Building on ${personal}, I want to complete a few practical details before any shortlist thinking.`,
    '',
    'We will cover career priorities, location, budget, family preferences, and your biggest concerns — each with a clear why.',
    '',
    'Ready? Reply when you are ready to continue.',
  ].join('\n');
}

module.exports = {
  STAGES,
  PERSONALIZATION_STEPS,
  MESSAGES,
  PERSONALIZATION_QA,
  getPersMessage,
  getNextPersStep,
  getPersStepOrder,
  getPersContentForStep,
  buildPersonalizedPersTransition,
  PERS_STEP_ORDER_DEFAULT,
  PERS_STEP_ORDER_FROM_EXPLORE,
};
