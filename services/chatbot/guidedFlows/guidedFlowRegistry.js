'use strict';

/**
 * Central registry of bot-state guided workflows (slot-filling and sticky subflows).
 * Register new flows here — orchestrator enforces routing, firewall bypass, and interrupts.
 */

const GUIDED_FLOW_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'college_predictor',
    botState: 'college_predictor',
    contextKey: 'college',
    continueIntent: 'college_predictor_continue',
    entryIntents: Object.freeze(['college_predictor']),
    slotFilling: true,
    completeBotState: 'main_menu',
    localizationTier: 'translate',
  }),
  Object.freeze({
    id: 'rank_predictor',
    botState: 'rank_predictor',
    contextKey: 'rank',
    continueIntent: 'rank_predictor_continue',
    entryIntents: Object.freeze(['rank_predictor']),
    slotFilling: true,
    completeBotState: 'main_menu',
    localizationTier: 'translate',
  }),
  Object.freeze({
    id: 'faq',
    botState: 'faq',
    contextKey: null,
    continueIntent: 'faq_query',
    entryIntents: Object.freeze(['faq', 'faq_query']),
    slotFilling: false,
    completeBotState: 'faq_answer',
    localizationTier: 'static',
  }),
  Object.freeze({
    id: 'career_counselling_v2',
    botState: 'career_counselling_v2',
    contextKey: 'careerCounselling',
    continueIntent: 'career_counselling_journey_continue',
    entryIntents: Object.freeze(['career_counselling_journey']),
    slotFilling: false,
    completeBotState: 'career_counselling_v2',
    localizationTier: 'translate',
  }),
]);

const BY_BOT_STATE = new Map(GUIDED_FLOW_DEFINITIONS.map((flow) => [flow.botState, flow]));
const BY_ID = new Map(GUIDED_FLOW_DEFINITIONS.map((flow) => [flow.id, flow]));
const BY_INTENT = new Map();
for (const flow of GUIDED_FLOW_DEFINITIONS) {
  for (const intent of flow.entryIntents) {
    BY_INTENT.set(intent, flow);
  }
  BY_INTENT.set(flow.continueIntent, flow);
}
const CONTINUE_INTENTS = new Set(GUIDED_FLOW_DEFINITIONS.map((flow) => flow.continueIntent));
const ENTRY_INTENTS = new Set(
  GUIDED_FLOW_DEFINITIONS.flatMap((flow) => [...flow.entryIntents, flow.continueIntent])
);

function listGuidedFlows() {
  return GUIDED_FLOW_DEFINITIONS;
}

function getGuidedFlowById(id) {
  return BY_ID.get(id) || null;
}

function getGuidedFlowByBotState(botStateName) {
  if (!botStateName) return null;
  return BY_BOT_STATE.get(botStateName) || null;
}

function getGuidedFlowByIntent(intent) {
  if (!intent) return null;
  return BY_INTENT.get(intent) || null;
}

function resolveActiveGuidedFlow(botState) {
  if (!botState?.state) return null;
  return getGuidedFlowByBotState(botState.state);
}

function isGuidedFlowContinueIntent(intent) {
  return CONTINUE_INTENTS.has(intent);
}

function isGuidedFlowEntryOrContinueIntent(intent) {
  return ENTRY_INTENTS.has(intent);
}

function shouldBypassScopeFirewall(botState, intent) {
  if (resolveActiveGuidedFlow(botState)) return true;
  return isGuidedFlowEntryOrContinueIntent(intent);
}

module.exports = {
  GUIDED_FLOW_DEFINITIONS,
  listGuidedFlows,
  getGuidedFlowById,
  getGuidedFlowByIntent,
  getGuidedFlowByBotState,
  resolveActiveGuidedFlow,
  isGuidedFlowContinueIntent,
  isGuidedFlowEntryOrContinueIntent,
  shouldBypassScopeFirewall,
};
