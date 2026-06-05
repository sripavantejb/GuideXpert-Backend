'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const keywordSearch = require('../services/chatbot/knowledgeSearchService');
const vectorService = require('../services/chatbot/knowledgeVectorSearchService');
const hybridService = require('../services/chatbot/knowledgeHybridSearchService');

const ORIGINAL_MODE = process.env.KNOWLEDGE_SEARCH_MODE;
const originalSearchKnowledgeHybrid = hybridService.searchKnowledgeHybrid;
const originalSearchKnowledgeVector = vectorService.searchKnowledgeVector;

afterEach(() => {
  hybridService.searchKnowledgeHybrid = originalSearchKnowledgeHybrid;
  vectorService.searchKnowledgeVector = originalSearchKnowledgeVector;
  if (ORIGINAL_MODE === undefined) {
    delete process.env.KNOWLEDGE_SEARCH_MODE;
  } else {
    process.env.KNOWLEDGE_SEARCH_MODE = ORIGINAL_MODE;
  }
});

describe('searchKnowledgeAsync', () => {
  test('resolveSearchMode defaults to hybrid', () => {
    delete process.env.KNOWLEDGE_SEARCH_MODE;
    assert.equal(keywordSearch.resolveSearchMode(), 'hybrid');
  });

  test('searchKnowledgeAsync routes to hybrid mode', async () => {
    process.env.KNOWLEDGE_SEARCH_MODE = 'hybrid';
    hybridService.searchKnowledgeHybrid = async () => ({
      results: [{ id: 15, category: 'a', question: 'Q', answer: 'A', score: 1 }],
      metrics: { mode: 'hybrid', totalMs: 5, resultIds: [15] },
    });

    const output = await keywordSearch.searchKnowledgeAsync('What is NIAT?', {
      retrievalQuery: 'What is NIAT?',
      limit: 5,
    });

    assert.equal(output.results[0].id, 15);
    assert.equal(output.metrics.mode, 'hybrid');
  });

  test('searchKnowledgeAsync keyword mode stays synchronous', async () => {
    process.env.KNOWLEDGE_SEARCH_MODE = 'keyword';
    const output = await keywordSearch.searchKnowledgeAsync('What is NIAT?', { limit: 5 });
    assert.ok(output.results.length > 0);
    assert.equal(output.results[0].id, 15);
    assert.equal(output.metrics.mode, 'keyword');
  });

  test('searchKnowledgeAsync vector mode delegates to vector service', async () => {
    process.env.KNOWLEDGE_SEARCH_MODE = 'vector';
    vectorService.searchKnowledgeVector = async () => ({
      results: [{ id: 15, category: 'a', question: 'Q', answer: 'A', score: 0.9, vectorScore: 0.9 }],
      metrics: { embedMs: 1, vectorSearchMs: 2, totalMs: 3, resultCount: 1 },
    });

    const output = await keywordSearch.searchKnowledgeAsync('What is NIAT?', { limit: 1 });
    assert.equal(output.results[0].id, 15);
    assert.equal(output.metrics.mode, 'vector');
  });
});
