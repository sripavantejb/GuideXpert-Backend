'use strict';

const OpenAI = require('openai');
const { aiDebugLog } = require('../../chatbot/aiDebugLog');

class OpenAiCompatibleProvider {
  /**
   * @param {{
   *   apiKey?: string,
   *   apiKeyEnv?: string,
   *   baseURL?: string,
   *   baseUrlEnv?: string,
   *   model?: string,
   *   modelEnv?: string,
   *   fallbackBaseUrlEnv?: string,
   *   fallbackModelEnv?: string,
   * }} [opts]
   */
  constructor(opts = {}) {
    this._opts = opts || {};
    this._client = null;
  }

  _resolveApiKey() {
    if (this._opts.apiKey) return String(this._opts.apiKey).trim();
    const envName = this._opts.apiKeyEnv || 'LLM_API_KEY';
    return String(process.env[envName] || '').trim();
  }

  _resolveBaseURL() {
    if (this._opts.baseURL) return String(this._opts.baseURL).trim();
    const envName = this._opts.baseUrlEnv || 'LLM_BASE_URL';
    const primary = String(process.env[envName] || '').trim();
    if (primary) return primary;
    const fallbackEnv = this._opts.fallbackBaseUrlEnv;
    return fallbackEnv ? String(process.env[fallbackEnv] || '').trim() : '';
  }

  _resolveModel() {
    if (this._opts.model) return String(this._opts.model).trim();
    const envName = this._opts.modelEnv || 'LLM_MODEL';
    const primary = String(process.env[envName] || '').trim();
    if (primary) return primary;
    const fallbackEnv = this._opts.fallbackModelEnv;
    return fallbackEnv ? String(process.env[fallbackEnv] || '').trim() : '';
  }

  _getClient() {
    if (this._client) return this._client;

    const apiKey = this._resolveApiKey();
    const baseURL = this._resolveBaseURL();
    const apiKeyLabel = this._opts.apiKeyEnv || 'LLM_API_KEY';
    const baseUrlLabel = this._opts.baseUrlEnv || 'LLM_BASE_URL';
    if (!apiKey || !baseURL) {
      throw new Error(`${apiKeyLabel} and ${baseUrlLabel} (or fallback) are required`);
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
    const model = this._resolveModel();
    if (!model) {
      const modelLabel = this._opts.modelEnv || 'LLM_MODEL';
      throw new Error(`${modelLabel} (or fallback) is required`);
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
