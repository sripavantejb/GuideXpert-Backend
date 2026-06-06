'use strict';

const { describe, test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const detectionPath = require.resolve('../services/language/languageDetectionService');
const translationPath = require.resolve('../services/language/translationService');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');

describe('multilingualMiddleware pivot', () => {
  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    delete require.cache[middlewarePath];
    delete require.cache[detectionPath];
    delete require.cache[translationPath];
    delete require.cache[conversationLangPath];
  });

  afterEach(() => {
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    mock.restoreAll();
    delete require.cache[middlewarePath];
    delete require.cache[detectionPath];
    delete require.cache[translationPath];
    delete require.cache[conversationLangPath];
  });

  test('prepareMultilingualInbound translates Telugu to English for assistant path', async () => {
    const detection = require(detectionPath);
    mock.method(detection, 'detectLanguage', async () => ({
      language: 'te',
      confidence: 0.9,
      source: 'offline',
    }));

    const translation = require(translationPath);
    mock.method(translation, 'translateToEnglish', async (text, lang) => {
      assert.equal(lang, 'te');
      return 'Can I get CSE with rank 15000?';
    });
    mock.method(translation, 'translateFromEnglish', async () => ({
      text: 'Telugu reply',
      translateFromEnglishExecuted: true,
      passThrough: false,
    }));

    const conversationLang = require(conversationLangPath);
    mock.method(conversationLang, 'recordDetectedLanguage', async () => {});

    const {
      prepareMultilingualInbound,
      finalizeMultilingualOutbound,
    } = require(middlewarePath);

    const inbound = await prepareMultilingualInbound({
      message: '15000 rank tho CSE vastunda?',
      conversation: { _id: '507f1f77bcf86cd799439011', preferredLanguage: 'te' },
      leadContext: {},
    });

    assert.equal(inbound.originalMessage, '15000 rank tho CSE vastunda?');
    assert.equal(inbound.englishMessage, 'Can I get CSE with rank 15000?');
    assert.equal(inbound.language, 'te');
    assert.equal(inbound.translationApplied, true);

    const outbound = await finalizeMultilingualOutbound({
      englishResponse: 'CSE is possible around rank 15000.',
      language: 'te',
      originalMessage: inbound.originalMessage,
    });
    assert.equal(outbound, 'Telugu reply');
  });

  test('passthrough when multilingual disabled', async () => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '0';
    delete require.cache[middlewarePath];
    const { prepareMultilingualInbound } = require(middlewarePath);

    const inbound = await prepareMultilingualInbound({
      message: 'What is NIAT?',
      conversation: null,
      leadContext: null,
    });

    assert.equal(inbound.englishMessage, 'What is NIAT?');
    assert.equal(inbound.language, 'en');
    assert.equal(inbound.translationApplied, false);
  });
});
