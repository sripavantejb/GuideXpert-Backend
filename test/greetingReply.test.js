'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveGreetingReply, GREETING_REPLIES } = require('../constants/greetingReplies');

describe('greetingReplies', () => {
  test('resolveGreetingReply returns localized replies for supported codes', () => {
    for (const code of ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn']) {
      assert.equal(resolveGreetingReply(code), GREETING_REPLIES[code], code);
    }
  });

  test('resolveGreetingReply falls back to English for unsupported codes', () => {
    assert.equal(resolveGreetingReply('xx'), GREETING_REPLIES.en);
  });
});
