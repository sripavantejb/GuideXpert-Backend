'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  loadKnowledgeBase,
  auditKnowledgeBase,
} = require('../utils/knowledgeBaseAudit');

describe('knowledgeBaseAudit', () => {
  test('live knowledgeBase.json passes audit', () => {
    const entries = loadKnowledgeBase();
    const result = auditKnowledgeBase(entries);

    assert.equal(result.ok, true, result.errors.join('; '));
    assert.deepEqual(result.errors, []);
  });

  test('id 11 exists with counselling-difference question', () => {
    const entries = loadKnowledgeBase();
    const entry = entries.find((row) => row.id === 11);

    assert.ok(entry);
    assert.match(entry.question, /counselling different from normal counselling/i);
  });

  test('id 10 answer no longer contains normal counselling merge', () => {
    const entries = loadKnowledgeBase();
    const entry = entries.find((row) => row.id === 10);

    assert.ok(entry);
    assert.doesNotMatch(entry.answer, /normal counselling/i);
    assert.doesNotMatch(entry.answer, /\t/);
  });

  test('auditKnowledgeBase detects duplicate ids', () => {
    const result = auditKnowledgeBase([
      { id: 1, category: 'a', question: 'Q?', answer: 'A' },
      { id: 1, category: 'a', question: 'Q2?', answer: 'A2' },
    ]);

    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /duplicate id 1/);
  });

  test('auditKnowledgeBase detects tab in answer', () => {
    const result = auditKnowledgeBase([
      { id: 1, category: 'a', question: 'Q?', answer: 'merged\tanswer' },
    ]);

    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /tab character/);
  });
});
