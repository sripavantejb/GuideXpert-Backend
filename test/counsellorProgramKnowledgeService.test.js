'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const knowledgePath = require.resolve(
  '../services/chatbot/counsellorProgram/counsellorProgramKnowledgeService'
);
const faqServicePath = require.resolve('../services/chatbot/faqService');
const searchPath = require.resolve('../services/chatbot/knowledgeSearchService');

describe('counsellorProgramKnowledgeService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[knowledgePath];
    delete require.cache[faqServicePath];
    delete require.cache[searchPath];
  });

  test('filterGuidexpertKbResults excludes non-GuideXpert KB chunks', () => {
    const { filterGuidexpertKbResults } = require(knowledgePath);
    const filtered = filterGuidexpertKbResults([
      { id: '1', category: 'niit_counselling', question: 'NIAT?', answer: 'NIAT info' },
      { id: '2', category: 'guidexpert', question: 'Programs?', answer: 'GX programs' },
      { id: '3', category: 'other', question: 'Other?', answer: 'Other info' },
    ]);

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].category, 'guidexpert');
  });

  test('searchCounsellorProgramKnowledge returns only program FAQ slugs', async () => {
    delete require.cache[knowledgePath];
    delete require.cache[faqServicePath];
    delete require.cache[searchPath];

    const faqService = require(faqServicePath);
    mock.method(faqService, 'searchStaticFaq', () => [
      { slug: 'what-is-guidexpert', title: 'What is GuideXpert?', answer: 'GX overview' },
      { slug: 'niat-placements', title: 'NIAT placements', answer: 'NIAT placement info' },
      { slug: 'book-demo', title: 'Book demo', answer: 'Demo booking steps' },
    ]);

    const searchService = require(searchPath);
    mock.method(searchService, 'searchKnowledgeAsync', async () => ({
      results: [
        { id: 'kb-1', category: 'guidexpert', question: 'Fees?', answer: 'Program fees' },
        { id: 'kb-2', category: 'niit_counselling', question: 'NIAT?', answer: 'NIAT' },
      ],
      metrics: { mode: 'keyword' },
    }));

    const { searchCounsellorProgramKnowledge } = require(knowledgePath);
    const retrieval = await searchCounsellorProgramKnowledge('program fees');

    assert.equal(retrieval.faqHits.length, 2);
    assert.ok(retrieval.faqHits.every((entry) =>
      ['what-is-guidexpert', 'book-demo'].includes(entry.slug)
    ));
    assert.equal(retrieval.kbResults.length, 1);
    assert.equal(retrieval.kbResults[0].category, 'guidexpert');
    assert.equal(retrieval.faqHits.some((entry) => entry.slug === 'niat-placements'), false);
  });

  test('searchCounsellorProgramKnowledge returns GuideXpert chunks for short program queries', async () => {
    delete require.cache[knowledgePath];
    delete require.cache[faqServicePath];
    delete require.cache[searchPath];

    const { searchCounsellorProgramKnowledge } = require(knowledgePath);

    for (const query of ['benefits', 'mentorship', 'duration', 'fees']) {
      const retrieval = await searchCounsellorProgramKnowledge(query);
      assert.ok(retrieval.faqHits.length > 0 || retrieval.kbResults.length > 0, query);
      assert.ok(
        retrieval.kbResults.every((entry) => entry.category === 'guidexpert'),
        query
      );
      assert.ok(retrieval.knowledgeContext.length > 0, query);
    }
  });
});
