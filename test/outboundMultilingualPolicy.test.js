'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { applyMultilingualOutbound } = require('../middleware/multilingualMiddleware');
const { setTranslationProvider } = require('../services/language/translationService');
const { KNOWLEDGE_ASSISTANT_FALLBACK_REPLY } = require('../constants/localizedFallbackStrings');

describe('outbound multilingual policy', () => {
  let prevMultilingual;

  beforeEach(() => {
    prevMultilingual = process.env.CHATBOT_MULTILINGUAL_ENABLED;
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
  });

  afterEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = prevMultilingual;
    setTranslationProvider(null);
  });

  test('translation timeout delivers original English business response', async () => {
    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('Request timed out.');
      },
    });

    const businessReply =
      'Here are your predicted colleges:\n\n1. VASAVI COLLEGE OF ENGINEERING\n   Branch: CSE';
    const result = await applyMultilingualOutbound({
      replyText: businessReply,
      resolvedLanguage: 'te',
      originalMessage: '1',
      localizationTier: 'translate',
    });

    assert.match(result.text, /VASAVI COLLEGE OF ENGINEERING/i);
    assert.doesNotMatch(result.text, /క్షమించండి|something went wrong/i);
    assert.equal(result.outboundTrace.usedEnglishFallback, true);
  });

  test('wrong-language translation output still delivers original English business response', async () => {
    setTranslationProvider({
      chatCompletion: async () => ({
        text: 'This is still English but marked as translated output.',
      }),
    });

    const businessReply =
      'JEE Main rank 5000 can get CSE at NIT Warangal based on last year cutoffs.';
    const result = await applyMultilingualOutbound({
      replyText: businessReply,
      resolvedLanguage: 'te',
      originalMessage: 'rank 5000',
      localizationTier: 'translate',
    });

    assert.match(result.text, /NIT Warangal/i);
    assert.doesNotMatch(result.text, /క్షమించండి|something went wrong/i);
    assert.equal(result.outboundTrace.usedEnglishFallback, true);
  });

  test('knowledge assistant answer is not replaced when translation fails', async () => {
    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('Request timed out.');
      },
    });

    const kaReply =
      'For TS EAMCET rank 2900 in BC-B category, you may qualify for top private engineering colleges in Hyderabad.';
    const result = await applyMultilingualOutbound({
      replyText: kaReply,
      resolvedLanguage: 'hi',
      originalMessage: 'colleges for rank 2900',
      localizationTier: 'translate',
    });

    assert.match(result.text, /TS EAMCET rank 2900/i);
    assert.doesNotMatch(result.text, /something went wrong|Maaf kijiye, hamari taraf/i);
    assert.equal(result.outboundTrace.usedEnglishFallback, true);
  });

  test('rank predictor style response is not replaced when translation fails', async () => {
    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('Request timed out.');
      },
    });

    const rankReply = [
      'Prediction for jeemainmarks:',
      'Rank: 15000',
      'Range: 14000 - 16000',
      'Reply MENU for main menu.',
    ].join('\n');

    const result = await applyMultilingualOutbound({
      replyText: rankReply,
      resolvedLanguage: 'te',
      originalMessage: '85',
      localizationTier: 'translate',
    });

    assert.match(result.text, /Prediction for jeemainmarks/i);
    assert.doesNotMatch(result.text, /క్షమించండి|something went wrong/i);
    assert.equal(result.outboundTrace.usedEnglishFallback, true);
  });

  test('known guardrail fallback strings are still localized without orchestrator fallback', async () => {
    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('should not be called for known fallback');
      },
    });

    const result = await applyMultilingualOutbound({
      replyText: KNOWLEDGE_ASSISTANT_FALLBACK_REPLY,
      resolvedLanguage: 'te',
      originalMessage: '???',
      localizationTier: 'translate',
    });

    assert.match(result.text, /MENU|AGENT|అర్థం/i);
    assert.doesNotMatch(result.text, /something went wrong on our side/i);
    assert.equal(result.outboundTrace.usedLocalizedFallback, true);
    assert.notEqual(result.outboundTrace.usedEnglishFallback, true);
  });

  test('empty business reply may use orchestrator fallback for non-English users', async () => {
    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('Request timed out.');
      },
    });

    const result = await applyMultilingualOutbound({
      replyText: '   ',
      resolvedLanguage: 'te',
      originalMessage: 'hi',
      localizationTier: 'translate',
    });

    assert.equal(result.text, '');
    assert.equal(result.verification.pass, false);
    assert.equal(result.outboundTrace.outboundOrchestratorFallback, undefined);
  });
});
