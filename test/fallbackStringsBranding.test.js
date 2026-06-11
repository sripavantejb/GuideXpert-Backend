'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  UNKNOWN_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
} = require('../services/chatbot/aiGuardrailService');
const { LOCALIZED_GUARDRAIL_FALLBACKS } = require('../constants/localizedFallbackStrings');

describe('fallback branding', () => {
  test('canonical English unsupported fallback uses GuideXpert counselling team', () => {
    assert.match(UNKNOWN_FALLBACK, /GuideXpert counselling team/i);
    assert.match(UNSUPPORTED_CLAIM_FALLBACK, /GuideXpert counselling team/i);
    assert.doesNotMatch(UNKNOWN_FALLBACK, /NIAT counselling team/i);
  });

  test('localized guardrail fallbacks do not mention NIAT counselling team', () => {
    for (const [lang, map] of Object.entries(LOCALIZED_GUARDRAIL_FALLBACKS)) {
      for (const [key, value] of Object.entries(map)) {
        assert.doesNotMatch(
          String(value),
          /NIAT counselling team/i,
          `${lang} ${key}`
        );
      }
    }
  });

  test('backend user-facing sources have no NIAT counselling team string', () => {
    const files = [
      '../services/chatbot/aiGuardrailService.js',
      '../constants/localizedFallbackStrings.js',
      '../services/ai/prompts/knowledgeAssistant.system.js',
    ].map((rel) => path.join(__dirname, rel));

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /NIAT counselling team/i, file);
    }
  });
});
