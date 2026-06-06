'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveConversationLanguage,
  isAmbiguousMessage,
} = require('../services/chatbot/conversationLanguageService');

describe('conversationLanguageService', () => {
  test('Rule 1: high-confidence detection beats stored preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      { iit: { preferredLanguage: 'Hindi' } },
      { language: 'hi', confidence: 0.99 },
      'मुझे CSE चाहिए'
    );
    assert.equal(result.language, 'hi');
    assert.equal(result.resolutionReason, 'high_confidence_detection');
  });

  test('Rule 1: high-confidence English beats stored Telugu preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      {},
      { language: 'en', confidence: 0.92 },
      'How are you?'
    );
    assert.equal(result.language, 'en');
    assert.equal(result.resolutionReason, 'high_confidence_detection');
  });

  test('Rule 2: ambiguous message uses conversation memory', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      {},
      { language: 'en', confidence: 0.5 },
      'ok'
    );
    assert.equal(result.language, 'te');
    assert.equal(result.resolutionReason, 'ambiguous_message_memory');
  });

  test('Rule 2: ambiguous thanks uses IIT lead when no stored preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'en' },
      { iit: { preferredLanguage: 'Telugu' } },
      { language: 'en', confidence: 0.4 },
      'thanks'
    );
    assert.equal(result.language, 'te');
    assert.equal(result.resolutionReason, 'ambiguous_message_memory');
  });

  test('uses detection when no stored preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'en' },
      {},
      { language: 'hi', confidence: 0.9 },
      'मुझे CSE चाहिए'
    );
    assert.equal(result.language, 'hi');
    assert.equal(result.resolutionReason, 'high_confidence_detection');
  });

  test('isAmbiguousMessage recognizes short acknowledgements', () => {
    assert.equal(isAmbiguousMessage('ok'), true);
    assert.equal(isAmbiguousMessage('thanks'), true);
    assert.equal(isAmbiguousMessage('👍'), true);
    assert.equal(isAmbiguousMessage('How are you?'), false);
  });
});
