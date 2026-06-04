'use strict';

const { OpenAiCompatibleProvider } = require('../ai/providers/OpenAiCompatibleProvider');
const { buildSystemPrompt } = require('../ai/prompts/knowledgeAssistant.system');

const provider = new OpenAiCompatibleProvider();

function isKnowledgeAssistantEnabled() {
  return (
    String(process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '').trim() === '1' ||
    String(process.env.CHATBOT_LLM_ENABLED || '').trim() === '1'
  );
}

async function answer({ inboundText }) {
  console.log('[LLM-DEBUG] entered knowledgeAssistantService');

  if (!isKnowledgeAssistantEnabled()) {
    console.log('[LLM-DEBUG] answer return null: knowledge assistant disabled');
    return null;
  }

  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    console.log('[LLM-DEBUG] answer return null: LLM_API_KEY missing');
    return null;
  }

  const text = String(inboundText || '').trim();
  if (!text) {
    console.log('[LLM-DEBUG] answer return null: empty inbound text');
    return null;
  }

  try {
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: text },
    ];

    const result = await provider.chatCompletion({ messages });
    if (result.text) {
      console.log('[LLM-DEBUG] received response', { model: result.model });
      return { text: result.text, model: result.model };
    }
    console.log('[LLM-DEBUG] answer return null: provider returned empty text');
  } catch (e) {
    console.warn('[chatbot] knowledge assistant error', e.message);
    console.log('[LLM-DEBUG] caught error =', e.message);
  }

  console.log('[LLM-DEBUG] answer return null: fallthrough after try/catch');
  return null;
}

module.exports = { answer };
