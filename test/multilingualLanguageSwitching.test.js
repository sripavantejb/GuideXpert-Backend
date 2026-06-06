'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const detectionPath = require.resolve('../services/language/languageDetectionService');
const translationPath = require.resolve('../services/language/translationService');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');

describe('multilingual language switching', () => {
  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    [
      middlewarePath,
      detectionPath,
      translationPath,
      conversationLangPath,
    ].forEach((path) => delete require.cache[path]);
  });

  afterEach(() => {
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    mock.restoreAll();
    [
      middlewarePath,
      detectionPath,
      translationPath,
      conversationLangPath,
    ].forEach((path) => delete require.cache[path]);
  });

  test('resolved language follows each high-confidence message in sequence', async () => {
    const detection = require(detectionPath);
    mock.method(detection, 'detectLanguage', async ({ message }) => {
      const map = {
        'naaku cse kavali': { language: 'te', confidence: 0.88, source: 'romanized' },
        'mujhe cse chahiye': { language: 'hi', confidence: 0.9, source: 'romanized' },
        'How are you?': { language: 'en', confidence: 0.92, source: 'offline' },
        'நீங்கள் எப்படி இருக்கிறீர்கள்?': { language: 'ta', confidence: 0.88, source: 'offline' },
      };
      return map[message] || { language: 'en', confidence: 0.5, source: 'fallback' };
    });

    const translation = require(translationPath);
    mock.method(translation, 'translateToEnglish', async (text) => `EN:${text}`);
    mock.method(translation, 'translateFromEnglish', async (text, lang) => ({
      text: `${lang}:${text}`,
      translateFromEnglishExecuted: true,
      passThrough: false,
    }));

    const conversationLang = require(conversationLangPath);
    mock.method(conversationLang, 'recordDetectedLanguage', async () => {});

    const { prepareMultilingualInbound } = require(middlewarePath);
    const conversation = {
      _id: new mongoose.Types.ObjectId(),
      preferredLanguage: 'te',
    };

    const teInbound = await prepareMultilingualInbound({
      message: 'naaku cse kavali',
      conversation,
      leadContext: { iit: { preferredLanguage: 'Telugu' } },
    });
    assert.equal(teInbound.resolvedLanguage, 'te');
    assert.equal(teInbound.resolutionReason, 'high_confidence_detection');

    const hiInbound = await prepareMultilingualInbound({
      message: 'mujhe cse chahiye',
      conversation,
      leadContext: { iit: { preferredLanguage: 'Telugu' } },
    });
    assert.equal(hiInbound.resolvedLanguage, 'hi');

    const enInbound = await prepareMultilingualInbound({
      message: 'How are you?',
      conversation,
      leadContext: { iit: { preferredLanguage: 'Telugu' } },
    });
    assert.equal(enInbound.resolvedLanguage, 'en');
    assert.equal(enInbound.englishMessage, 'How are you?');

    const taInbound = await prepareMultilingualInbound({
      message: 'நீங்கள் எப்படி இருக்கிறீர்கள்?',
      conversation,
      leadContext: { iit: { preferredLanguage: 'Telugu' } },
    });
    assert.equal(taInbound.resolvedLanguage, 'ta');
  });

  test('ambiguous ok keeps stored preference when detection is low confidence', async () => {
    const detection = require(detectionPath);
    mock.method(detection, 'detectLanguage', async () => ({
      language: 'en',
      confidence: 0.5,
      source: 'fallback',
    }));

    const translation = require(translationPath);
    mock.method(translation, 'translateToEnglish', async (text) => text);

    const conversationLang = require(conversationLangPath);
    mock.method(conversationLang, 'recordDetectedLanguage', async () => {});

    const { prepareMultilingualInbound } = require(middlewarePath);
    const inbound = await prepareMultilingualInbound({
      message: 'ok',
      conversation: { preferredLanguage: 'hi' },
      leadContext: {},
    });

    assert.equal(inbound.resolvedLanguage, 'hi');
    assert.equal(inbound.resolutionReason, 'ambiguous_message_memory');
  });
});
