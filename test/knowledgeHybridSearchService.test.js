'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const keywordSearch = require('../services/chatbot/knowledgeSearchService');
const vectorService = require('../services/chatbot/knowledgeVectorSearchService');
const hybridService = require('../services/chatbot/knowledgeHybridSearchService');

const originalSearchKnowledgeVector = vectorService.searchKnowledgeVector;
const originalSearchKnowledgeKeyword = keywordSearch.searchKnowledgeKeyword;

afterEach(() => {
  vectorService.searchKnowledgeVector = originalSearchKnowledgeVector;
  keywordSearch.searchKnowledgeKeyword = originalSearchKnowledgeKeyword;
});

describe('knowledgeHybridSearchService', () => {
  test('searchKnowledgeHybrid reranks vector and keyword recall', async () => {
    vectorService.searchKnowledgeVector = async () => ({
      results: [
        {
          id: 11,
          category: 'niit_counselling',
          question: 'How is this counselling different from normal counselling?',
          answer: 'Personalized guidance',
          score: 0.88,
          vectorScore: 0.88,
        },
      ],
      metrics: { embedMs: 10, vectorSearchMs: 5, totalMs: 15, resultCount: 1 },
    });
    keywordSearch.searchKnowledgeKeyword = () => [
      {
        id: 23,
        category: 'niit_counselling',
        question: 'Is the future of core branches not good?',
        answer: 'Core branches answer',
        score: 23,
        keywordScore: 23,
      },
    ];

    const output = await hybridService.searchKnowledgeHybrid('iam not getting', {
      retrievalQuery: 'iam not getting',
      limit: 2,
      recallLimit: 20,
    });

    assert.equal(output.metrics.mode, 'hybrid');
    assert.equal(output.results.length, 2);
    assert.deepEqual(new Set(output.metrics.resultIds), new Set([11, 23]));
    assert.equal(output.metrics.fallback, null);
  });

  test('searchKnowledgeHybrid falls back to keyword when vector fails', async () => {
    vectorService.searchKnowledgeVector = async () => {
      throw new Error('vector unavailable');
    };
    keywordSearch.searchKnowledgeKeyword = () => [
      {
        id: 15,
        category: 'niit_counselling',
        question: 'What exactly is NIAT?',
        answer: 'NIAT answer',
        score: 94,
        keywordScore: 94,
      },
    ];

    const output = await hybridService.searchKnowledgeHybrid('What is NIAT?', { limit: 1 });

    assert.equal(output.metrics.fallback, 'keyword');
    assert.equal(output.results[0].id, 15);
  });
});
