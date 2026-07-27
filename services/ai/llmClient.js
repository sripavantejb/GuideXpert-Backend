'use strict';

const { OpenAiCompatibleProvider } = require('./providers/OpenAiCompatibleProvider');

const provider = new OpenAiCompatibleProvider();

/**
 * Thin helper used by college comparison (and similar tools).
 * Returns { content, model, usage } for a system+user turn, or a full messages array.
 */
async function chatCompletion({
  systemPrompt,
  userPrompt,
  messages,
  temperature = 0.2,
  maxTokens = 400,
  timeoutMs,
}) {
  const resolvedMessages = Array.isArray(messages) && messages.length
    ? messages.map((m) => ({
        role: String(m.role || 'user'),
        content: String(m.content || ''),
      }))
    : [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(userPrompt || '') },
      ];

  const result = await provider.chatCompletion({
    messages: resolvedMessages,
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
