'use strict';

const { describe, test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  translateToEnglish,
  translateFromEnglish,
  restorePreserveTerms,
  setTranslationProvider,
} = require('../services/language/translationService');

describe('translationService', () => {
  afterEach(() => {
    mock.restoreAll();
    setTranslationProvider(null);
  });

  test('short-circuits English source and target', async () => {
    const input = 'Can I get CSE with rank 15000?';
    assert.equal(await translateToEnglish(input, 'en'), input);
    assert.equal((await translateFromEnglish(input, 'en')).text, input);
  });

  test('restorePreserveTerms keeps CSE and numeric ranks', () => {
    const restored = restorePreserveTerms(
      'Can I get cse with rank fifteen thousand?',
      '15000 rank tho CSE vastunda?',
      ['CSE', '15000']
    );
    assert.match(restored, /CSE/i);
    assert.match(restored, /15000/);
  });

  test('translateToEnglish uses provider and preserves glossary tokens', async () => {
    setTranslationProvider({
      chatCompletion: async ({ messages }) => {
        assert.match(messages[0].content, /CSE/);
        return { text: 'Can I get CSE with rank 15000?' };
      },
    });

    const result = await translateToEnglish('15000 rank tho CSE vastunda?', 'te');
    assert.match(result, /CSE/);
    assert.match(result, /15000/);
  });

  test('translateFromEnglish uses provider for target language', async () => {
    setTranslationProvider({
      chatCompletion: async ({ messages }) => {
        assert.match(messages[0].content, /te/);
        return { text: 'CSE 15000 rank tho vastundi.' };
      },
    });

    const result = await translateFromEnglish('You can get CSE around rank 15000.', 'te');
    assert.match(result.text, /CSE/);
    assert.match(result.text, /15000/);
    assert.equal(result.translateFromEnglishExecuted, true);
    assert.equal(result.passThrough, false);
  });

  test('returns original text when provider fails', async () => {
    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('LLM unavailable');
      },
    });

    const telugu = 'నాకు ఏ బ్రాంచ్ మంచిది?';
    assert.equal(await translateToEnglish(telugu, 'te'), telugu);
    const outbound = await translateFromEnglish('Branch guidance reply.', 'te');
    assert.equal(outbound.text, 'Branch guidance reply.');
    assert.equal(outbound.passThrough, true);
  });
});
