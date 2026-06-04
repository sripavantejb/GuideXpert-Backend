'use strict';

const { answer } = require('./knowledgeAssistantService');

function isLlmReplyEnabled() {
  return (
    String(process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '').trim() === '1' ||
    String(process.env.CHATBOT_LLM_ENABLED || '').trim() === '1'
  );
}

/**
 * Phase 4 Sprint 1: delegates to knowledgeAssistantService (NVIDIA OpenAI-compatible API).
 * Disabled unless CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED=1 or CHATBOT_LLM_ENABLED=1.
 */
async function tryLlmReply({ inboundText, facts, leadContext }) {
  void facts;
  void leadContext;

  if (!isLlmReplyEnabled()) {
    return null;
  }

  const llm = await answer({ inboundText });
  if (llm && llm.text) {
    return { text: String(llm.text).trim().slice(0, 3500) };
  }
  return null;
}

module.exports = { tryLlmReply };
