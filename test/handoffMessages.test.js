'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { HANDOFF_RESOLVED_USER_MESSAGE } = require('../constants/handoffMessages');

describe('handoffMessages', () => {
  test('HANDOFF_RESOLVED_USER_MESSAGE informs session ended without MENU prompt', () => {
    assert.match(HANDOFF_RESOLVED_USER_MESSAGE, /session with our counsellor has ended/i);
    assert.match(HANDOFF_RESOLVED_USER_MESSAGE, /continue chatting with GuideXpert/i);
    assert.doesNotMatch(HANDOFF_RESOLVED_USER_MESSAGE, /MENU/i);
    assert.doesNotMatch(HANDOFF_RESOLVED_USER_MESSAGE, /chat is back/i);
  });
});
