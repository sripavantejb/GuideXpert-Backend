'use strict';

const { answerWithTimeout } = require('./knowledgeAssistantService');
const { aiDebugLog } = require('./aiDebugLog');

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

  aiDebugLog('LLM-DEBUG', 'entered tryLlmReply');
  const enabled = isLlmReplyEnabled();
  aiDebugLog('LLM-DEBUG', 'knowledge assistant enabled =', enabled);
  const apiKeyPresent = Boolean(String(process.env.LLM_API_KEY || '').trim());
  aiDebugLog('LLM-DEBUG', 'api key present =', apiKeyPresent);

  if (!enabled) {
    aiDebugLog('LLM-DEBUG', 'tryLlmReply return null: knowledge assistant disabled');
    return null;
  }

  const llm = await answerWithTimeout({ inboundText, conversationId, leadContext });
  if (llm && llm.text) {
    return { text: String(llm.text).trim().slice(0, 3500) };
  }
  aiDebugLog('LLM-DEBUG', 'tryLlmReply return null: answer() returned no text');
  return null;
}

module.exports = { tryLlmReply };
