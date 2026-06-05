'use strict';

const OpenAI = require('openai');
const { aiDebugLog } = require('../../chatbot/aiDebugLog');

class OpenAiCompatibleProvider {
  constructor() {
    this._client = null;
  }

  _getClient() {
    if (this._client) return this._client;

    const apiKey = String(process.env.LLM_API_KEY || '').trim();
    const baseURL = String(process.env.LLM_BASE_URL || '').trim();
    if (!apiKey || !baseURL) {
      throw new Error('LLM_API_KEY and LLM_BASE_URL are required');
    }

    this._client = new OpenAI({
      apiKey,
      baseURL,
      timeout: Number(process.env.LLM_TIMEOUT_MS) || 20000,
      maxRetries: Number(process.env.LLM_MAX_RETRIES) || 2,
    });
    return this._client;
  }

  async chatCompletion({ messages, temperature = 1, maxTokens = 1000, timeoutMs, maxRetries }) {
    aiDebugLog('LLM-DEBUG', 'entered OpenAiCompatibleProvider');
    const model = String(process.env.LLM_MODEL || '').trim();
    if (!model) {
      throw new Error('LLM_MODEL is required');
    }

    aiDebugLog('LLM-DEBUG', 'calling NVIDIA model =', model);
    const client = this._getClient();
    const requestOptions = {};
    if (timeoutMs != null) {
      requestOptions.timeout = timeoutMs;
    }
    if (maxRetries != null) {
      requestOptions.maxRetries = maxRetries;
    }

    const completion = await client.chat.completions.create(
      {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      },
      Object.keys(requestOptions).length ? requestOptions : undefined
    );

    aiDebugLog('LLM-DEBUG', 'received response');
    const text = completion.choices?.[0]?.message?.content || '';
    return {
      text: String(text).trim(),
      model: completion.model,
    };
  }
}

module.exports = { OpenAiCompatibleProvider };
