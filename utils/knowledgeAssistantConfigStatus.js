'use strict';

function isKnowledgeAssistantEnabled() {
  return (
    String(process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '').trim() === '1' ||
    String(process.env.CHATBOT_LLM_ENABLED || '').trim() === '1'
  );
}

function getKnowledgeAssistantConfigStatus() {
  const enabled = isKnowledgeAssistantEnabled();
  const llmKeyPresent = Boolean(String(process.env.LLM_API_KEY || '').trim());
  const llmBaseUrlPresent = Boolean(String(process.env.LLM_BASE_URL || '').trim());
  const llmModelPresent = Boolean(String(process.env.LLM_MODEL || '').trim());
  const ready = enabled && llmKeyPresent && llmBaseUrlPresent && llmModelPresent;

  return {
    enabled,
    llmKeyPresent,
    llmBaseUrl: process.env.LLM_BASE_URL || null,
    llmModel: process.env.LLM_MODEL || null,
    ready,
  };
}

function logKnowledgeAssistantConfigStatus() {
  const status = getKnowledgeAssistantConfigStatus();
  console.log({
    knowledgeAssistantEnabled: process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED,
    llmKeyPresent: status.llmKeyPresent,
    llmBaseUrl: process.env.LLM_BASE_URL,
    llmModel: process.env.LLM_MODEL,
  });
  if (!status.ready) {
    const missing = [];
    if (!status.enabled) missing.push('CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED=1');
    if (!status.llmKeyPresent) missing.push('LLM_API_KEY');
    if (!status.llmBaseUrlPresent) missing.push('LLM_BASE_URL');
    if (!status.llmModelPresent) missing.push('LLM_MODEL');
    console.warn('[env] Knowledge Assistant not ready — missing or disabled:', missing.join(', '));
  }
}

module.exports = {
  isKnowledgeAssistantEnabled,
  getKnowledgeAssistantConfigStatus,
  logKnowledgeAssistantConfigStatus,
};
