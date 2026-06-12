'use strict';

const LEAD_EVENT_TYPES = Object.freeze([
  'rank_mentioned',
  'exam_mentioned',
  'branch_preference',
  'college_preference',
  'counselling_stage_question',
  'quota_category_mentioned',
  'program_interest',
  'demo_interest',
  'price_sensitivity',
  'language_preference',
  'handoff_requested',
  'float_slide_freeze_interest',
]);

const ASSISTANT_TYPES = Object.freeze([
  'ice',
  'ics',
  'cpa',
  'ka',
  'rank_predictor',
  'college_predictor',
  'static',
  'unknown',
]);

const LEAD_EVENT_TYPE_SET = new Set(LEAD_EVENT_TYPES);
const ASSISTANT_TYPE_SET = new Set(ASSISTANT_TYPES);

const MIN_CONFIDENCE = 0.5;

function resolveLeadEventExtractionTimeoutMs() {
  const configured = Number(process.env.LEAD_EVENT_EXTRACTION_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return 6000;
}

function resolveAssistantType(intent, contextPatch = {}) {
  if (contextPatch?.iitCounsellingStrategyActive) return 'ics';
  if (contextPatch?.iitCounsellingExpertActive) return 'ice';
  if (contextPatch?.counsellorProgramAssistantActive) return 'cpa';
  if (contextPatch?.knowledgeAssistantActive) return 'ka';

  switch (intent) {
    case 'iit_counselling_strategy':
      return 'ics';
    case 'iit_counselling_expert':
      return 'ice';
    case 'counsellor_program_assistant':
      return 'cpa';
    case 'knowledge_assistant':
      return 'ka';
    case 'rank_predictor':
    case 'rank_predictor_continue':
      return 'rank_predictor';
    case 'college_predictor':
    case 'college_predictor_continue':
      return 'college_predictor';
    case 'greeting':
    case 'main_menu':
    case 'faq':
    case 'faq_query':
    case 'counselling_support':
    case 'demo_support':
    case 'lead_lookup':
    case 'assigned_expert':
      return 'static';
    default:
      return 'unknown';
  }
}

module.exports = {
  LEAD_EVENT_TYPES,
  ASSISTANT_TYPES,
  LEAD_EVENT_TYPE_SET,
  ASSISTANT_TYPE_SET,
  MIN_CONFIDENCE,
  resolveLeadEventExtractionTimeoutMs,
  resolveAssistantType,
};
