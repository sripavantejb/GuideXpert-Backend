'use strict';

const OpenAI = require('openai');

class NvidiaEmbeddingProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL;
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.client = options.client || null;
    this._client = null;
  }

  _getClient() {
    if (this.client) return this.client;
    if (this._client) return this._client;

    const apiKey = String(this.apiKey || '').trim();
    const baseURL = String(this.baseURL || '').trim();
    if (!apiKey || !baseURL) {
      throw new Error('EMBEDDING_API_KEY and EMBEDDING_BASE_URL are required');
    }

    this._client = new OpenAI({
      apiKey,
      baseURL,
      timeout: this.timeoutMs,
      maxRetries: this.maxRetries,
    });
    return this._client;
  }

  async createEmbeddings(texts, options = {}) {
    const model = String(this.model || '').trim();
    if (!model) {
      throw new Error('EMBEDDING_MODEL is required');
    }

    const input = texts
      .map((text) => String(text || '').trim())
      .filter((text) => text.length > 0);
    if (input.length === 0) {
      return [];
    }

    const dimensions = Number(this.dimensions);
    const inputType = String(options.inputType || this.inputType || '').trim();
    const client = this._getClient();
    const response = await client.embeddings.create({
      model,
      input,
      ...(inputType ? { input_type: inputType } : {}),
      ...(Number.isFinite(dimensions) && dimensions > 0 ? { dimensions } : {}),
    });

    const sorted = [...(response.data || [])].sort(
      (a, b) => Number(a.index) - Number(b.index)
    );
    const vectors = sorted.map((row) => row.embedding);

    for (let i = 0; i < vectors.length; i += 1) {
      const vector = vectors[i];
      if (!Array.isArray(vector)) {
        throw new Error(`Embedding API returned invalid vector at index ${i}`);
      }
      if (Number.isFinite(dimensions) && dimensions > 0 && vector.length !== dimensions) {
        throw new Error(
          `Embedding dimension mismatch at index ${i}: expected ${dimensions}, got ${vector.length}`
        );
      }
    }

    return vectors;
  }
}

module.exports = { NvidiaEmbeddingProvider };
