'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGE_CODES,
  TRANSLATION_PROBE_MESSAGES,
  SAMPLE_ENGLISH_FOR_OUTBOUND,
} = require('../constants/languageMatrixProbes');

describe('translationLanguageMatrix mocked round-trip', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[require.resolve('../services/language/languageDetectionService')];
    delete require.cache[require.resolve('../services/language/translationService')];
  });

  test('each supported language round-trips through mocked provider', async () => {
    const detectionPath = require.resolve('../services/language/languageDetectionService');
    const translationPath = require.resolve('../services/language/translationService');
    delete require.cache[detectionPath];
    delete require.cache[translationPath];

    const detection = require(detectionPath);
    mock.method(detection, 'detectLanguage', async ({ message }) => {
      const lang = LANGUAGE_CODES.find((code) => TRANSLATION_PROBE_MESSAGES[code] === message) || 'en';
      return { language: lang, confidence: 0.88, source: 'offline' };
    });

    const translation = require(translationPath);
    mock.method(translation, 'translateToEnglish', async (text, source) => {
      if (source === 'en') return text;
      return `EN:${text}`;
    });
    mock.method(translation, 'translateFromEnglish', async (text, target) => ({
      text: target === 'en' ? text : `${target}:${text}`,
      translateFromEnglishExecuted: true,
      passThrough: false,
    }));

    for (const lang of LANGUAGE_CODES) {
      const message = TRANSLATION_PROBE_MESSAGES[lang];
      const detected = await detection.detectLanguage({ message });
      assert.equal(detected.language, lang);

      const english = await translation.translateToEnglish(message, lang);
      if (lang === 'en') {
        assert.equal(english, message);
      } else {
        assert.match(english, /^EN:/);
      }

      const outbound = await translation.translateFromEnglish(SAMPLE_ENGLISH_FOR_OUTBOUND, lang);
      if (lang === 'en') {
        assert.equal(outbound.text, SAMPLE_ENGLISH_FOR_OUTBOUND);
      } else {
        assert.match(outbound.text, new RegExp(`^${lang}:`));
      }
    }
  });
});
