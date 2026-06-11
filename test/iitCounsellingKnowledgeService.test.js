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

    const { searchIitCounsellingKnowledge } = require(knowledgePath);
    const retrieval = await searchIitCounsellingKnowledge('What is JoSAA?');

    assert.equal(retrieval.kbResults.length, 2);
    assert.ok(retrieval.kbResults.every((entry) => entry.category !== 'guidexpert'));
    assert.ok(retrieval.knowledgeContext.includes('JoSAA'));
  });

  test('expandIitQuery expands short float token', () => {
    const { expandIitQuery } = require(knowledgePath);
    const expanded = expandIitQuery('float');
    assert.match(expanded, /JoSAA/i);
  });
});
