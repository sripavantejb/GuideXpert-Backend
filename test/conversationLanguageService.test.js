'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveConversationLanguage,
} = require('../services/chatbot/conversationLanguageService');

describe('conversationLanguageService', () => {
  test('resolveConversationLanguage prefers stored conversation preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'te' },
      { iit: { preferredLanguage: 'Hindi' } },
      { language: 'hi', confidence: 0.99 }
    );
    assert.equal(result.language, 'te');
    assert.equal(result.source, 'conversation');
  });

  test('resolveConversationLanguage falls back to IIT lead language', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'en' },
      { iit: { preferredLanguage: 'Telugu' } },
      { language: 'hi', confidence: 0.99 }
    );
    assert.equal(result.language, 'te');
    assert.equal(result.source, 'iit_lead');
  });

  test('resolveConversationLanguage uses detection when no stored preference', () => {
    const result = resolveConversationLanguage(
      { preferredLanguage: 'en' },
      {},
      { language: 'hi', confidence: 0.9 }
    );
    assert.equal(result.language, 'hi');
    assert.equal(result.source, 'detection');
  });
});
