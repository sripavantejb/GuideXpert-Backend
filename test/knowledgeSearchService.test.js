'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { searchKnowledge } = require('../services/chatbot/knowledgeSearchService');
const { buildKnowledgeContext } = require('../services/chatbot/knowledgeContextBuilder');

describe('knowledgeSearchService', () => {
  test('searchKnowledge returns relevant NIAT entries with score', () => {
    const results = searchKnowledge('What is NIAT?', 5);

    assert.ok(results.length > 0);
    assert.equal(results[0].id, 15);
    assert.equal(results[0].question, 'What exactly is NIAT?');
    assert.ok(results[0].score > 0);
    assert.ok(results.length <= 5);
  });

  test('searchKnowledge returns empty results for no knowledge match', () => {
    const results = searchKnowledge('GuideXpert', 5);

    assert.deepEqual(results, []);
  });
});

describe('knowledgeContextBuilder', () => {
  test('buildKnowledgeContext includes only matched entries', () => {
    const results = searchKnowledge('What is Data Science?', 2);
    const context = buildKnowledgeContext(results);

    assert.match(context, /Knowledge Entry 1/);
    assert.match(context, /Question:\nWhat is Data Science\?/);
    assert.match(context, /Answer:/);
    assert.doesNotMatch(context, /Knowledge Entry 3/);
  });

  test('buildKnowledgeContext returns empty string with no matches', () => {
    assert.equal(buildKnowledgeContext([]), '');
  });
});
