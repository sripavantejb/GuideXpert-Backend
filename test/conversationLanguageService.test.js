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
    assert.equal(isAmbiguousMessage('hi'), false);
  });

  test('AU/SVU and menu digits are not ambiguous language signals', () => {
    assert.equal(isAmbiguousMessage('AU'), false);
    assert.equal(isAmbiguousMessage('SVU'), false);
    assert.equal(isAmbiguousMessage('1'), false);
    assert.equal(isAmbiguousMessage('OC'), false);
    assert.equal(isAmbiguousMessage('Female'), false);
  });

  test('AU does not inherit Telugu lead memory when detection is weak', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      { iit: { preferredLanguage: 'Telugu' } },
      { language: 'en', confidence: 0.4 },
      'AU'
    );
    assert.equal(result.language, 'en');
    assert.equal(result.resolutionReason, 'guided_flow_slot_token');
  });

  test('SVU does not inherit Telugu conversation preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      {},
      { language: 'te', confidence: 0.2 },
      'SVU'
    );
    assert.equal(result.language, 'en');
    assert.equal(result.resolutionReason, 'guided_flow_slot_token');
  });

  test('explicit English greeting hi switches to English over stored Telugu', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      { iit: { preferredLanguage: 'Telugu' } },
      { language: 'en', confidence: 0.5 },
      'hi'
    );
    assert.equal(result.language, 'en');
    assert.equal(result.resolutionReason, 'explicit_english_greeting');
  });

  test('explicit Telugu greeting ela vunnav switches to Telugu over stored English', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'en' },
      {},
      { language: 'en', confidence: 0.92 },
      'ela vunnav'
    );
    assert.equal(result.language, 'te');
    assert.equal(result.resolutionReason, 'explicit_telugu_greeting');
  });
});
