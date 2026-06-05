'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { rerankKnowledgeResults } = require('../services/chatbot/knowledgeRerankService');

describe('knowledgeRerankService', () => {
  test('rerankKnowledgeResults prefers overlapping NIAT entry', () => {
    const vectorResults = [
      {
        id: 15,
        category: 'niit_counselling',
        question: 'What exactly is NIAT?',
        answer: 'NIAT answer',
        score: 0.92,
        vectorScore: 0.92,
        keywordScore: null,
      },
      {
        id: 20,
        category: 'niit_counselling',
        question: 'How is NIAT different?',
        answer: 'Different answer',
        score: 0.81,
        vectorScore: 0.81,
        keywordScore: null,
      },
    ];
    const keywordResults = [
      {
        id: 15,
        category: 'niit_counselling',
        question: 'What exactly is NIAT?',
        answer: 'NIAT answer',
        score: 94,
        keywordScore: 94,
        vectorScore: null,
      },
    ];

    const ranked = rerankKnowledgeResults({
      vectorResults,
      keywordResults,
      query: 'What is NIAT?',
      limit: 2,
    });

    assert.equal(ranked[0].id, 15);
    assert.ok(ranked[0].score > 0);
  });

  test('rerankKnowledgeResults includes vector-only hits', () => {
    const ranked = rerankKnowledgeResults({
      vectorResults: [
        {
          id: 99,
          category: 'niit_counselling',
          question: 'Vector only?',
          answer: 'Only vector',
          score: 0.7,
          vectorScore: 0.7,
        },
      ],
      keywordResults: [],
      query: 'vector only',
      limit: 1,
    });

    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, 99);
  });
});
