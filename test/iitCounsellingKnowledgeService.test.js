'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const knowledgePath = require.resolve(
  '../services/chatbot/iitCounsellingExpert/iitCounsellingKnowledgeService'
);
const searchPath = require.resolve('../services/chatbot/knowledgeSearchService');

describe('iitCounsellingKnowledgeService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[knowledgePath];
    delete require.cache[searchPath];
  });

  test('filterIitCounsellingKbResults keeps iit_counselling and niit_counselling only', () => {
    const { filterIitCounsellingKbResults } = require(knowledgePath);
    const filtered = filterIitCounsellingKbResults([
      { id: '1', category: 'iit_counselling', question: 'JoSAA?', answer: 'JoSAA info' },
      { id: '2', category: 'niit_counselling', question: 'NIAT?', answer: 'NIAT info' },
      { id: '3', category: 'guidexpert', question: 'Programs?', answer: 'GX programs' },
    ]);

    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((entry) => ['iit_counselling', 'niit_counselling'].includes(entry.category)));
  });

  test('searchIitCounsellingKnowledge excludes guidexpert chunks', async () => {
    delete require.cache[knowledgePath];
    delete require.cache[searchPath];

    const searchService = require(searchPath);
    mock.method(searchService, 'searchKnowledgeAsync', async () => ({
      results: [
        { id: 'kb-1', category: 'iit_counselling', question: 'What is JoSAA?', answer: 'JoSAA body' },
        { id: 'kb-2', category: 'guidexpert', question: 'Fees?', answer: 'Program fees' },
        { id: 'kb-3', category: 'niit_counselling', question: 'Counselling?', answer: 'Session info' },
      ],
      metrics: { mode: 'keyword' },
    }));
    mock.method(searchService, 'searchKnowledgeKeyword', () => [
      { id: 'kb-1', category: 'iit_counselling', question: 'What is JoSAA?', answer: 'JoSAA body', score: 120 },
    ]);

    const { searchIitCounsellingKnowledge } = require(knowledgePath);
    const retrieval = await searchIitCounsellingKnowledge('What is JoSAA?');

    assert.equal(retrieval.kbResults.length, 2);
    assert.ok(retrieval.kbResults.every((entry) => entry.category !== 'guidexpert'));
    assert.ok(retrieval.knowledgeContext.includes('JoSAA'));
  });

  test('searchIitCounsellingKnowledge merges keyword IIT hits when hybrid filter is empty', async () => {
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
        id: 'ice-1',
        category: 'iit_counselling',
        question: 'What is OBC-NCL rank?',
        answer: 'OBC-NCL rank is the category rank for OBC-NCL seats.',
        score: 320,
      },
    ]);

    const { searchIitCounsellingKnowledge } = require(knowledgePath);
    const retrieval = await searchIitCounsellingKnowledge('What is OBC-NCL rank?');

    assert.equal(retrieval.kbResults.length, 1);
    assert.equal(retrieval.kbResults[0].id, 'ice-1');
    assert.equal(retrieval.metrics.retrievalFallback, 'keyword_merge');
  });

  test('resolveTopicFallbackChunks returns curated OBC-NCL chunk', () => {
    const { resolveTopicFallbackChunks } = require(knowledgePath);
    const chunks = resolveTopicFallbackChunks('What is OBC-NCL rank?');
    assert.ok(chunks.length >= 1);
    assert.match(chunks[0].question, /OBC-NCL rank/i);
    assert.ok(String(chunks[0].answer || '').length > 20);
  });

  test('resolveDirectKbAnswer returns exact question match', () => {
    const { resolveDirectKbAnswer } = require(knowledgePath);
    const answer = resolveDirectKbAnswer(
      [
        {
          question: 'What is float?',
          answer: 'Float lets you accept a seat while seeking a higher preference.',
        },
      ],
      'What is float?'
    );
    assert.match(answer, /Float lets you accept/i);
  });

  test('expandIitQuery expands short float token', () => {
    const { expandIitQuery } = require(knowledgePath);
    const expanded = expandIitQuery('float');
    assert.match(expanded, /JoSAA/i);
  });
});
