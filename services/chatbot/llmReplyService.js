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
async function tryLlmReply({ inboundText, conversationId = null, facts, leadContext }) {
  void facts;

  console.log('[LLM-DEBUG] entered tryLlmReply');
  const enabled = isLlmReplyEnabled();
  console.log('[LLM-DEBUG] knowledge assistant enabled =', enabled);
  const apiKeyPresent = Boolean(String(process.env.LLM_API_KEY || '').trim());
  console.log('[LLM-DEBUG] api key present =', apiKeyPresent);

  if (!enabled) {
    console.log('[LLM-DEBUG] tryLlmReply return null: knowledge assistant disabled');
    return null;
  }

  const llm = await answer({ inboundText, conversationId, leadContext });
  if (llm && llm.text) {
    return { text: String(llm.text).trim().slice(0, 3500) };
  }
  console.log('[LLM-DEBUG] tryLlmReply return null: answer() returned no text');
  return null;
}

module.exports = { tryLlmReply };
