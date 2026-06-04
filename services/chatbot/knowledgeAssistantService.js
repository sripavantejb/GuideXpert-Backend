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
  if (!isKnowledgeAssistantEnabled()) {
    return null;
  }

  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const text = String(inboundText || '').trim();
  if (!text) {
    return null;
  }

  try {
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: text },
    ];

    const result = await provider.chatCompletion({ messages });
    if (result.text) {
      return { text: result.text, model: result.model };
    }
  } catch (e) {
    console.warn('[chatbot] knowledge assistant error', e.message);
  }

  return null;
}

module.exports = { answer };
