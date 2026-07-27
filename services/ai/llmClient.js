'use strict';

const { OpenAiCompatibleProvider } = require('./providers/OpenAiCompatibleProvider');

const provider = new OpenAiCompatibleProvider();

/**
 * Thin helper used by college comparison (and similar tools).
 * Returns { content, model, usage } for a simple system+user chat turn.
 */
async function chatCompletion({
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  maxTokens = 400,
  timeoutMs,
}) {
  const result = await provider.chatCompletion({
    messages: [
      { role: 'system', content: String(systemPrompt || '') },
      { role: 'user', content: String(userPrompt || '') },
    ],
    temperature,
    maxTokens,
    timeoutMs,
  });

  return {
    content: String(result.text || '').trim(),
    model: result.model || null,
    usage: result.usage || null,
  };
}

module.exports = { chatCompletion };
