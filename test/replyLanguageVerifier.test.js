'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { assertReplyLanguage } = require('../utils/replyLanguageVerifier');
const { GREETING_REPLIES } = require('../constants/greetingReplies');

describe('replyLanguageVerifier', () => {
  test('accepts English ASCII replies', () => {
    const result = assertReplyLanguage("I'm doing well. How can I help you today?", 'en');
    assert.equal(result.pass, true);
  });

  test('distinguishes Marathi vs Hindi greeting replies', () => {
    const mr = assertReplyLanguage(GREETING_REPLIES.mr, 'mr');
    assert.equal(mr.pass, true);
    assert.equal(mr.detected, 'mr');

    const hi = assertReplyLanguage(GREETING_REPLIES.hi, 'hi');
    assert.equal(hi.pass, true);
    assert.equal(hi.detected, 'hi');
  });

  test('accepts native script replies for te ta kn ml bn', () => {
    for (const lang of ['te', 'ta', 'kn', 'ml', 'bn']) {
      const result = assertReplyLanguage(GREETING_REPLIES[lang], lang);
      assert.equal(result.pass, true, lang);
      assert.equal(result.detected, lang, lang);
    }
  });
});
