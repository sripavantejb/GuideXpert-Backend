'use strict';

const { isIitCounsellingStrategyEnabled } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyFlags');
const { isIitCounsellingExpertEnabled } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingFlags');
const { getKnowledgeAssistantConfigStatus } = require('./knowledgeAssistantConfigStatus');

function getIitCounsellingStrategyConfigStatus() {
  const strategyFlag =
    String(process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED || '').trim() === '1';
  const iceEnabled = isIitCounsellingExpertEnabled();
  const enabled = isIitCounsellingStrategyEnabled();
  const knowledgeAssistant = getKnowledgeAssistantConfigStatus();
  const ready = enabled && iceEnabled && knowledgeAssistant.ready;

  return {
    enabled,
    strategyFlag,
    iceEnabled,
    ready,
  };
}

function logIitCounsellingStrategyConfigStatus() {
  const status = getIitCounsellingStrategyConfigStatus();
  console.log({
    iitCounsellingStrategyEnabled: process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED,
    iitCounsellingStrategyReady: status.ready,
    iceRequiredForStrategy: status.iceEnabled,
  });
  if (status.strategyFlag && !status.iceEnabled) {
    console.warn(
      '[env] IIT Counselling Strategy requires CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED=1'
    );
  }
  if (status.enabled && !status.ready) {
    console.warn(
      '[env] IIT Counselling Strategy not ready — set strategy + ICE flags and LLM_API_KEY, LLM_BASE_URL, LLM_MODEL'
    );
  }
}

module.exports = {
  getIitCounsellingStrategyConfigStatus,
  logIitCounsellingStrategyConfigStatus,
};
