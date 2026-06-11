'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveIitCounsellingStrategySessionAwareLanguage,
  isShortIitCounsellingStrategyFollowUp,
} = require('../services/chatbot/conversationLanguageService');

describe('IIT counselling strategy session language continuity', () => {
  test('short strategy follow-ups inherit session language', () => {
    assert.equal(isShortIitCounsellingStrategyFollowUp('placements'), true);
    assert.equal(isShortIitCounsellingStrategyFollowUp('What if I like coding?'), true);

    const resolved = resolveIitCounsellingStrategySessionAwareLanguage({
      conversation: { preferredLanguage: 'hi' },
      leadContext: {},
      detected: { language: 'en', confidence: 0.9 },
      message: 'placements',
      sessionLanguage: 'hi',
    });

    assert.equal(resolved.language, 'hi');
    assert.equal(resolved.resolutionReason, 'iit_counselling_strategy_session_language');
  });

  test('Telugu session keeps Telugu on coding follow-up', () => {
    const resolved = resolveIitCounsellingStrategySessionAwareLanguage({
      conversation: {},
      leadContext: {},
      detected: { language: 'en', confidence: 0.85 },
      message: 'coding',
      sessionLanguage: 'te',
    });

    assert.equal(resolved.language, 'te');
    assert.equal(resolved.resolutionReason, 'iit_counselling_strategy_session_language');
  });

  test('high-confidence Telugu detection switches away from Hindi session', () => {
    const resolved = resolveIitCounsellingStrategySessionAwareLanguage({
      conversation: { preferredLanguage: 'hi' },
      leadContext: {},
      detected: { language: 'te', confidence: 0.9 },
      message: 'CSE leda ECE?',
      sessionLanguage: 'hi',
    });

    assert.equal(resolved.language, 'te');
    assert.equal(resolved.resolutionReason, 'iit_counselling_strategy_language_detected');
  });

  test('explicit English greeting still switches session to English', () => {
    const resolved = resolveIitCounsellingStrategySessionAwareLanguage({
      conversation: { preferredLanguage: 'hi' },
      leadContext: {},
      detected: { language: 'en', confidence: 0.5 },
      message: 'hi',
      sessionLanguage: 'hi',
    });

    assert.equal(resolved.language, 'en');
    assert.equal(resolved.resolutionReason, 'explicit_english_greeting');
  });
});
