'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRetrievalQuery } = require('../utils/knowledgeQueryBuilder');

describe('knowledgeQueryBuilder', () => {
  test('buildRetrievalQuery returns current message when no history', () => {
    assert.equal(buildRetrievalQuery({ currentMessage: 'What is NIAT?' }), 'What is NIAT?');
  });

  test('buildRetrievalQuery expands follow-up with prior user turn', () => {
    const query = buildRetrievalQuery({
      currentMessage: 'How is it different?',
      history: [
        { role: 'user', content: 'What is NIAT?' },
        { role: 'assistant', content: 'NIAT focuses on industry readiness.' },
      ],
    });

    assert.equal(query, 'What is NIAT?\nHow is it different?');
  });

  test('buildRetrievalQuery ignores duplicate current message in history', () => {
    const query = buildRetrievalQuery({
      currentMessage: 'What is NIAT?',
      history: [{ role: 'user', content: 'What is NIAT?' }],
    });

    assert.equal(query, 'What is NIAT?');
  });
});
