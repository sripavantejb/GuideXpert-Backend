'use strict';

const { isCounsellorProgramAssistantEnabled } = require('../services/chatbot/counsellorProgram/counsellorProgramFlags');
const { getKnowledgeAssistantConfigStatus } = require('./knowledgeAssistantConfigStatus');

function getCounsellorProgramAssistantConfigStatus() {
  const enabled = isCounsellorProgramAssistantEnabled();
  const knowledgeAssistant = getKnowledgeAssistantConfigStatus();
  const ready = enabled && knowledgeAssistant.ready;

  return {
    enabled,
    ready,
  };
}

function logCounsellorProgramAssistantConfigStatus() {
  const status = getCounsellorProgramAssistantConfigStatus();
  console.log({
    counsellorProgramAssistantEnabled: process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED,
    counsellorProgramAssistantReady: status.ready,
  });
  if (enabledButNotReady(status)) {
    const missing = [];
    if (!status.enabled) missing.push('CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED=1');
    if (!status.ready && status.enabled) {
      missing.push('Knowledge Assistant LLM config (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL)');
    }
    console.warn('[env] Counsellor Program Assistant not ready — missing or disabled:', missing.join(', '));
  }
}

function enabledButNotReady(status) {
  return !status.ready;
}

module.exports = {
  getCounsellorProgramAssistantConfigStatus,
  logCounsellorProgramAssistantConfigStatus,
};
