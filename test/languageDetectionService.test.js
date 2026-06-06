'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLanguageCode,
  isSupportedLanguage,
  mapFrancCode,
  estimateOfflineConfidence,
} = require('../services/language/languageDetectionService');

describe('languageDetectionService helpers', () => {
  test('normalizeLanguageCode maps CRM labels to ISO', () => {
    assert.equal(normalizeLanguageCode('Telugu'), 'te');
    assert.equal(normalizeLanguageCode('Hindi'), 'hi');
    assert.equal(normalizeLanguageCode('tamil'), 'ta');
    assert.equal(normalizeLanguageCode(''), 'en');
  });

  test('isSupportedLanguage accepts Phase 6 codes', () => {
    assert.equal(isSupportedLanguage('te'), true);
    assert.equal(isSupportedLanguage('xx'), false);
  });

  test('mapFrancCode maps ISO 639-3 to supported ISO 639-1', () => {
    assert.equal(mapFrancCode('tel'), 'te');
    assert.equal(mapFrancCode('hin'), 'hi');
    assert.equal(mapFrancCode('tam'), 'ta');
    assert.equal(mapFrancCode('und'), null);
  });

  test('estimateOfflineConfidence is higher for Indic script samples', () => {
    const teConfidence = estimateOfflineConfidence('15000 ర్యాంక్‌తో CSE వస్తుందా?', 'te');
    const enConfidence = estimateOfflineConfidence('Can I get CSE with rank 15000?', 'en');
    assert.ok(teConfidence >= 0.75);
    assert.ok(enConfidence >= 0.75);
  });
});

describe('languageDetectionService.detectLanguage offline', () => {
  test('detects Telugu, Hindi, Tamil, and English samples offline', async () => {
    const { detectLanguage, setLanguageDetectionProvider } = require('../services/language/languageDetectionService');
    setLanguageDetectionProvider({
      chatCompletion: async () => {
        throw new Error('LLM should not be called');
      },
    });

    const te = await detectLanguage({ message: '15000 ర్యాంక్‌తో CSE వస్తుందా?' });
    assert.equal(te.language, 'te');
    assert.equal(te.source, 'offline');

    const hi = await detectLanguage({ message: '15000 रैंक पर CSE मिलेगा क्या?' });
    assert.equal(hi.language, 'hi');

    const ta = await detectLanguage({ message: 'CSE கிடைக்குமா?' });
    assert.equal(ta.language, 'ta');

    const en = await detectLanguage({ message: 'Can I get CSE with rank 15000?' });
    assert.equal(en.language, 'en');
    assert.equal(en.source, 'offline');
  });

  test('detects Romanized Telugu and Hindi before offline English return', async () => {
    const { detectLanguage, setLanguageDetectionProvider } = require('../services/language/languageDetectionService');
    setLanguageDetectionProvider({
      chatCompletion: async () => {
        throw new Error('LLM should not be called');
      },
    });

    const romanizedCases = [
      { message: 'em chesthunnav', language: 'te' },
      { message: 'thinnava', language: 'te' },
      { message: 'ela unnaru', language: 'te' },
      { message: 'nenu bagunnanu', language: 'te' },
      { message: 'kaise ho', language: 'hi' },
      { message: 'khana khaya', language: 'hi' },
      { message: 'naaku cse kavali', language: 'te' },
      { message: 'mujhe cse chahiye', language: 'hi' },
      { message: 'meri rank 15000 hai', language: 'hi' },
      { message: '15000 rank ki cse vastunda', language: 'te' },
    ];

    for (const { message, language } of romanizedCases) {
      const result = await detectLanguage({ message });
      assert.equal(result.language, language, message);
      assert.equal(result.source, 'romanized', message);
      assert.equal(result.confidence, 0.88, message);
    }

    const english = await detectLanguage({ message: 'Can I get CSE with rank 15000?' });
    assert.equal(english.language, 'en');
    assert.equal(english.source, 'offline');
  });

  test('falls back to English for empty input', async () => {
    const { detectLanguage } = require('../services/language/languageDetectionService');
    const result = await detectLanguage({ message: '   ' });
    assert.equal(result.language, 'en');
    assert.equal(result.source, 'fallback');
  });
});
