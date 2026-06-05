'use strict';

const { NvidiaEmbeddingProvider } = require('./providers/NvidiaEmbeddingProvider');

const DEFAULT_MODEL = 'nvidia/llama-nemotron-embed-1b-v2';
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 2;

let providerInstance = null;
let providerOverride = null;

function resolveEmbeddingConfig(overrides = {}) {
  const apiKey =
    String(overrides.apiKey || process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || '').trim();
  const baseURL =
    String(
      overrides.baseURL || process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL || ''
    ).trim();
  const model = String(overrides.model || process.env.EMBEDDING_MODEL || DEFAULT_MODEL).trim();
  const dimensions = Number(
    overrides.dimensions || process.env.EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS
  );
  const batchSize = Number(
    overrides.batchSize || process.env.EMBEDDING_BATCH_SIZE || DEFAULT_BATCH_SIZE
  );
  const timeoutMs = Number(
    overrides.timeoutMs || process.env.EMBEDDING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS
  );
  const maxRetries = Number(
    overrides.maxRetries || process.env.EMBEDDING_MAX_RETRIES || DEFAULT_MAX_RETRIES
  );

  return {
    apiKey,
    baseURL,
    model,
    dimensions,
    batchSize: Math.max(1, batchSize),
    timeoutMs,
    maxRetries,
  };
}

function getEmbeddingProvider(overrides = {}) {
  if (providerOverride) {
    return providerOverride;
  }

  if (overrides.apiKey || overrides.baseURL || overrides.model || overrides.dimensions) {
    const config = resolveEmbeddingConfig(overrides);
    return new NvidiaEmbeddingProvider(config);
  }

  if (!providerInstance) {
    providerInstance = new NvidiaEmbeddingProvider(resolveEmbeddingConfig());
  }
  return providerInstance;
}

function resetEmbeddingProviderForTests() {
  providerInstance = null;
  providerOverride = null;
}

function setEmbeddingProviderForTests(provider) {
  providerOverride = provider || null;
}

async function embedTexts(texts, options = {}) {
  const config = resolveEmbeddingConfig(options);
  const provider = getEmbeddingProvider(config);
  const input = Array.isArray(texts) ? texts : [texts];
  const cleaned = input
    .map((text) => String(text || '').trim())
    .filter((text) => text.length > 0);

  if (cleaned.length === 0) {
    return [];
  }

  const vectors = [];
  for (let i = 0; i < cleaned.length; i += config.batchSize) {
    const batch = cleaned.slice(i, i + config.batchSize);
    const batchVectors = await provider.createEmbeddings(batch, {
      inputType: options.inputType,
    });
    vectors.push(...batchVectors);
  }

  return vectors;
}

async function embedDocuments(texts, options = {}) {
  return embedTexts(texts, { ...options, inputType: options.inputType || 'passage' });
}

async function embedQuery(text, options = {}) {
  const [vector] = await embedTexts([text], { ...options, inputType: options.inputType || 'query' });
  return vector || null;
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
  DEFAULT_BATCH_SIZE,
  resolveEmbeddingConfig,
  getEmbeddingProvider,
  resetEmbeddingProviderForTests,
  setEmbeddingProviderForTests,
  embedDocuments,
  embedQuery,
  embedTexts,
};
