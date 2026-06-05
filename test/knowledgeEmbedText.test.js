'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEmbedText } = require('../utils/knowledgeEmbedText');

describe('knowledgeEmbedText', () => {
  test('buildEmbedText formats category, question, and answer', () => {
    const text = buildEmbedText({
      category: 'niit_counselling',
      question: 'What is NIAT?',
      answer: 'NIAT focuses on industry readiness.',
    });

    assert.equal(
      text,
      [
        'Category: niit_counselling',
        'Question: What is NIAT?',
        'Answer: NIAT focuses on industry readiness.',
      ].join('\n')
    );
  });
});
