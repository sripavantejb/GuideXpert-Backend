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

  /**
   * @param {{
   *   messages: Array,
   *   temperature?: number,
   *   maxTokens?: number,
   *   timeoutMs?: number,
   *   maxRetries?: number,
   *   tools?: Array,
   *   toolChoice?: string|object,
   *   responseFormat?: object|null,
   * }} args
   * @returns {Promise<{ text: string, model: string, toolCalls: Array|null, finishReason: string|null, rawMessage: object|null }>}
   */
  async chatCompletion({
    messages,
    temperature = 1,
    maxTokens = 1000,
    timeoutMs,
    maxRetries,
    tools = null,
    toolChoice = null,
    responseFormat = null,
  }) {
    aiDebugLog('LLM-DEBUG', 'entered OpenAiCompatibleProvider');
    const model = String(process.env.LLM_MODEL || '').trim();
    if (!model) {
      throw new Error('LLM_MODEL is required');
    }

    aiDebugLog('LLM-DEBUG', 'calling model =', model);
    const client = this._getClient();
    const requestOptions = {};
    if (timeoutMs != null) {
      requestOptions.timeout = timeoutMs;
    }
    if (maxRetries != null) {
      requestOptions.maxRetries = maxRetries;
    }

    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };
    if (Array.isArray(tools) && tools.length) {
      body.tools = tools;
      if (toolChoice != null) body.tool_choice = toolChoice;
    }
    if (responseFormat) {
      body.response_format = responseFormat;
    }

    const completion = await client.chat.completions.create(
      body,
      Object.keys(requestOptions).length ? requestOptions : undefined
    );

    aiDebugLog('LLM-DEBUG', 'received response');
    const choice = completion.choices?.[0] || {};
    const message = choice.message || {};
    const text = message.content || '';
    const toolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length
      ? message.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name,
            arguments: tc.function?.arguments || '{}',
          },
        }))
      : null;

    return {
      text: String(text || '').trim(),
      model: completion.model,
      toolCalls,
      finishReason: choice.finish_reason || null,
      rawMessage: message,
    };
  }
}

module.exports = { OpenAiCompatibleProvider };
