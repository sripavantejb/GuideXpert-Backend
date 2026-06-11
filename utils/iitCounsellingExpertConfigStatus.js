'use strict';

const { isIitCounsellingExpertEnabled } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingFlags');
const { getKnowledgeAssistantConfigStatus } = require('./knowledgeAssistantConfigStatus');

function getIitCounsellingExpertConfigStatus() {
  const enabled = isIitCounsellingExpertEnabled();
  const knowledgeAssistant = getKnowledgeAssistantConfigStatus();
  const ready = enabled && knowledgeAssistant.ready;

  return {
    enabled,
    ready,
  };
}

function logIitCounsellingExpertConfigStatus() {
  const status = getIitCounsellingExpertConfigStatus();
  console.log({
    iitCounsellingExpertEnabled: process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED,
    iitCounsellingExpertReady: status.ready,
  });
  if (status.enabled && !status.ready) {
    console.warn(
      '[env] IIT Counselling Expert not ready — set CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED=1 and LLM_API_KEY, LLM_BASE_URL, LLM_MODEL'
    );
  }
}

module.exports = {
  getIitCounsellingExpertConfigStatus,
  logIitCounsellingExpertConfigStatus,
};
