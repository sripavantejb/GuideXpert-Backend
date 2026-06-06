'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectRomanizedLanguage,
  normalizeRomanizedText,
  ROMANIZED_CONFIDENCE,
} = require('../services/language/romanizedLanguageDetectionService');

describe('romanizedLanguageDetectionService', () => {
  test('normalizeRomanizedText lowercases and collapses whitespace', () => {
    assert.equal(normalizeRomanizedText('  Em   Chesthunnav  '), 'em chesthunnav');
  });

  test('detects Telugu phrases', () => {
    const cases = [
      'em chesthunnav',
      'thinnava',
      'tinnava',
      'ela unnaru',
      'ela vunnaru',
      'nenu bagunnanu',
    ];
    for (const message of cases) {
      const result = detectRomanizedLanguage(message);
      assert.ok(result, `expected match for "${message}"`);
      assert.equal(result.language, 'te');
      assert.equal(result.confidence, ROMANIZED_CONFIDENCE);
    }
  });

  test('detects Telugu strong tokens in longer messages', () => {
    const result = detectRomanizedLanguage('hey chesthunnav bro');
    assert.equal(result.language, 'te');
    assert.equal(result.matched, 'chesthunnav');
  });

  test('detects Hindi phrases', () => {
    const cases = ['kaise ho', 'khana khaya', 'kya kar rahe ho', 'aap kaise ho'];
    for (const message of cases) {
      const result = detectRomanizedLanguage(message);
      assert.ok(result, `expected match for "${message}"`);
      assert.equal(result.language, 'hi');
      assert.equal(result.confidence, ROMANIZED_CONFIDENCE);
    }
  });

  test('detects Hindi counselling tokens in mixed messages', () => {
    assert.equal(detectRomanizedLanguage('mujhe')?.language, 'hi');
    assert.equal(detectRomanizedLanguage('chahiye')?.language, 'hi');
    assert.equal(detectRomanizedLanguage('mujhe cse chahiye')?.language, 'hi');
    assert.equal(detectRomanizedLanguage('meri rank 15000 hai')?.language, 'hi');
    assert.equal(detectRomanizedLanguage('I need mujhe help')?.language, 'hi');
  });

  test('detects Telugu counselling mixed messages', () => {
    const cases = [
      'naaku cse kavali',
      '15000 rank ki cse vastunda',
      'rank tho cse vastunda',
    ];
    for (const message of cases) {
      const result = detectRomanizedLanguage(message);
      assert.ok(result, `expected match for "${message}"`);
      assert.equal(result.language, 'te', message);
    }
  });

  test('returns null for English counselling queries', () => {
    assert.equal(detectRomanizedLanguage('Can I get CSE with rank 15000?'), null);
    assert.equal(detectRomanizedLanguage('hello how are placements at niat'), null);
  });

  test('returns null for non-ASCII input', () => {
    assert.equal(detectRomanizedLanguage('15000 ర్యాంక్‌తో CSE వస్తుందా?'), null);
  });
});
