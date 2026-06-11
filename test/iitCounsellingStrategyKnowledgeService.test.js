'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const knowledgePath = require.resolve(
  '../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyKnowledgeService'
);
const searchPath = require.resolve('../services/chatbot/knowledgeSearchService');

describe('iitCounsellingStrategyKnowledgeService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[knowledgePath];
    delete require.cache[searchPath];
  });

  test('filterStrategyKbResults keeps iit_counselling_strategy only', () => {
    const { filterStrategyKbResults } = require(knowledgePath);
    const filtered = filterStrategyKbResults([
      { id: '1', category: 'iit_counselling_strategy', question: 'CSE vs ECE?', answer: 'Trade-offs' },
      { id: '2', category: 'iit_counselling', question: 'What is float?', answer: 'Float info' },
      { id: '3', category: 'guidexpert', question: 'Fees?', answer: 'Program fees' },
    ]);

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].category, 'iit_counselling_strategy');
  });

  test('searchIitCounsellingStrategyKnowledge merges keyword strategy hits', async () => {
    delete require.cache[knowledgePath];
    delete require.cache[searchPath];

    const searchService = require(searchPath);
    mock.method(searchService, 'searchKnowledgeAsync', async () => ({
      results: [
        { id: 'gx-1', category: 'guidexpert', question: 'Fees?', answer: 'Program fees', score: 300 },
      ],
      metrics: { mode: 'hybrid', vectorCount: 1, keywordCount: 5 },
    }));
    mock.method(searchService, 'searchKnowledgeKeyword', () => [
      {
        id: 'ics-1',
        category: 'iit_counselling_strategy',
        question: 'CSE vs ECE?',
        answer: 'Compare branch interests and career direction.',
        score: 320,
      },
    ]);

    const { searchIitCounsellingStrategyKnowledge } = require(knowledgePath);
    const retrieval = await searchIitCounsellingStrategyKnowledge('CSE vs ECE?');

    assert.equal(retrieval.kbResults.length, 1);
    assert.equal(retrieval.kbResults[0].id, 'ics-1');
    assert.equal(retrieval.metrics.retrievalFallback, 'keyword_merge');
  });

  test('resolveTopicFallbackChunks returns CSE vs ECE chunk after import', () => {
    const { resolveTopicFallbackChunks } = require(knowledgePath);
    const chunks = resolveTopicFallbackChunks('CSE vs ECE?');
    assert.ok(chunks.length >= 1);
    assert.match(chunks[0].question, /CSE|ECE/i);
  });

  test('expandStrategyQuery expands short float token', () => {
    const { expandStrategyQuery } = require(knowledgePath);
    const expanded = expandStrategyQuery('float');
    assert.match(expanded, /float/i);
  });

  test('resolveTopicFallbackChunks returns slide strategy chunk', () => {
    const { resolveTopicFallbackChunks } = require(knowledgePath);
    const chunks = resolveTopicFallbackChunks('Should I use slide?');
    assert.ok(chunks.length >= 1);
    assert.match(chunks[0].question, /slide/i);
    assert.ok(String(chunks[0].answer || '').trim().length > 20);
  });
});
