'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { NvidiaEmbeddingProvider } = require('../services/ai/providers/NvidiaEmbeddingProvider');
const {
  embedDocuments,
  embedQuery,
  resetEmbeddingProviderForTests,
  resolveEmbeddingConfig,
  setEmbeddingProviderForTests,
} = require('../services/ai/embeddingService');

const ORIGINAL_ENV = {
  EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
  EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
  EMBEDDING_BATCH_SIZE: process.env.EMBEDDING_BATCH_SIZE,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
};

function createMockProvider(createEmbeddingsImpl) {
  return {
    createEmbeddings: createEmbeddingsImpl,
  };
}

afterEach(() => {
  resetEmbeddingProviderForTests();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('embeddingService', () => {
  test('resolveEmbeddingConfig falls back to LLM env vars', () => {
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    process.env.LLM_API_KEY = 'llm-key';
    process.env.LLM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

    const config = resolveEmbeddingConfig();
    assert.equal(config.apiKey, 'llm-key');
    assert.equal(config.baseURL, 'https://integrate.api.nvidia.com/v1');
    assert.equal(config.model, 'nvidia/llama-nemotron-embed-1b-v2');
    assert.equal(config.dimensions, 1024);
  });

  test('embedDocuments batches requests through provider', async () => {
    process.env.EMBEDDING_BATCH_SIZE = '2';

    const calls = [];
    setEmbeddingProviderForTests(
      createMockProvider(async (texts) => {
        calls.push(texts);
        return texts.map((_, index) => Array.from({ length: 1024 }, (_, i) => i + index + 1));
      })
    );

    const vectors = await embedDocuments(['a', 'b', 'c']);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['a', 'b']);
    assert.deepEqual(calls[1], ['c']);
    assert.equal(vectors.length, 3);
    assert.equal(vectors[0].length, 1024);
    assert.equal(vectors[0][0], 1);
    assert.equal(vectors[1][0], 2);
    assert.equal(vectors[2][0], 1);
  });

  test('embedQuery returns a single vector', async () => {
    setEmbeddingProviderForTests(
      createMockProvider(async () => [Array.from({ length: 1024 }, () => 0.5)])
    );

    const vector = await embedQuery('What is NIAT?');
    assert.ok(Array.isArray(vector));
    assert.equal(vector.length, 1024);
  });

  test('NvidiaEmbeddingProvider throws on dimension mismatch', async () => {
    const provider = new NvidiaEmbeddingProvider({
      model: 'nvidia/llama-nemotron-embed-1b-v2',
      dimensions: 1024,
      client: {
        embeddings: {
          create: async () => ({
            data: [{ index: 0, embedding: [0.1, 0.2] }],
          }),
        },
      },
    });

    await assert.rejects(
      () => provider.createEmbeddings(['bad-dimensions']),
      /Embedding dimension mismatch/
    );
  });
});
