'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 1 Student Discovery Engine.
 * Configuration-driven copy and discovery step order.
 */

const FLOW_ID = 'career_counselling_v2';

const STAGES = Object.freeze({
  DISCOVERY: 'discovery',
  EVALUATION_FRAMEWORK: 'evaluation_framework',
  MODERN_COLLEGES: 'modern_colleges',
  PERSONALIZED_DISCOVERY: 'personalized_discovery',
  EXPLORE_MODERN_COLLEGES: 'explore_modern_colleges',
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
  /** @deprecated Phase 5→6 bridge; prefer SMART_COMPARISON */
  COMPARISON_PLACEHOLDER: 'comparison_placeholder',
});

const DISCOVERY_STEPS = Object.freeze([
  'awaiting_qualification',
  'awaiting_course',
  'awaiting_career_goal',
  'awaiting_shortlist',
  'awaiting_language',
]);

const MESSAGES = Object.freeze({
  greeting: 'Hello! Glad you reached out 👍',

  professional_intro: [
    'I am your admissions counsellor.',
    '',
    'Before any college names, I will understand you first — one step at a time.',
  ].join('\n'),

  ask_qualification:
    'What is your current qualification? (Class 12, Intermediate, B.Tech year, or Graduation)',

  ask_course: 'Which course or field are you aiming for next?',

  ask_career_goal: 'What career are you aiming for?',

  ask_shortlist: 'Any colleges already on your mind? Or say “not yet”.',

  ask_language: 'Preferred language — English, Telugu, or Hindi?',

  ack_qualification: 'Got it 👍',
  ack_course: 'Perfect.',
  ack_career_goal: 'Nice!',
  ack_shortlist: 'Noted.',
  ack_language: 'Perfect.',

  skip_note: 'No problem.',

  correction_ack: 'Updated — thanks.',

  greeting_mid_journey: 'Hello again! Let’s continue from where we left off.',

  clarify_qualification:
    'What’s your current class or qualification? (Class 11/12, Intermediate, Graduation)',

  clarify_course: 'Which course interests you — engineering, medicine, or something else?',

  clarify_career_goal: 'What career or type of work are you aiming for?',

  clarify_shortlist: 'Any colleges you’re considering? Or say “not yet”.',

  clarify_language: 'Which language works best — English, Telugu, or Hindi?',

  discovery_complete_intro: 'Thanks — I now have a solid picture of your profile.',

  profile_summary_header: 'Quick summary:',
});

const PROFILE_FIELDS = Object.freeze([
  'currentQualification',
  'currentClass',
  'preferredCourse',
  'careerGoal',
  'preferredColleges',
  'preferredLanguage',
]);

function isCareerCounsellingV2Enabled() {
  const raw = String(process.env.CHATBOT_CAREER_COUNSELLING_JOURNEY_ENABLED ?? '1').trim();
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

function getMessage(key) {
  return MESSAGES[key] || '';
}

function getNextStep(currentStep) {
  const idx = DISCOVERY_STEPS.indexOf(currentStep);
  if (idx < 0 || idx >= DISCOVERY_STEPS.length - 1) return null;
  return DISCOVERY_STEPS[idx + 1];
}

function getQuestionForStep(step) {
  switch (step) {
    case 'awaiting_qualification':
      return getMessage('ask_qualification');
    case 'awaiting_course':
      return getMessage('ask_course');
    case 'awaiting_career_goal':
      return getMessage('ask_career_goal');
    case 'awaiting_shortlist':
      return getMessage('ask_shortlist');
    case 'awaiting_language':
      return getMessage('ask_language');
    default:
      return '';
  }
}

function getClarifyForStep(step) {
  switch (step) {
    case 'awaiting_qualification':
      return getMessage('clarify_qualification');
    case 'awaiting_course':
      return getMessage('clarify_course');
    case 'awaiting_career_goal':
      return getMessage('clarify_career_goal');
    case 'awaiting_shortlist':
      return getMessage('clarify_shortlist');
    case 'awaiting_language':
      return getMessage('clarify_language');
    default:
      return getMessage('clarify_qualification');
  }
}

function getAckForStep(step) {
  switch (step) {
    case 'awaiting_qualification':
      return getMessage('ack_qualification');
    case 'awaiting_course':
      return getMessage('ack_course');
    case 'awaiting_career_goal':
      return getMessage('ack_career_goal');
    case 'awaiting_shortlist':
      return getMessage('ack_shortlist');
    case 'awaiting_language':
      return getMessage('ack_language');
    default:
      return '';
  }
}

module.exports = {
  FLOW_ID,
  STAGES,
  DISCOVERY_STEPS,
  MESSAGES,
  PROFILE_FIELDS,
  isCareerCounsellingV2Enabled,
  getMessage,
  getNextStep,
  getQuestionForStep,
  getClarifyForStep,
  getAckForStep,
};
