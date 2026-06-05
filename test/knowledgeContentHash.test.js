'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { hashEmbedText } = require('../utils/knowledgeContentHash');

describe('knowledgeContentHash', () => {
  test('hashEmbedText is deterministic', () => {
    const text = 'Category: a\nQuestion: Q?\nAnswer: A';
    assert.equal(hashEmbedText(text), hashEmbedText(text));
  });

  test('hashEmbedText changes when text changes', () => {
    assert.notEqual(hashEmbedText('alpha'), hashEmbedText('beta'));
  });
});
