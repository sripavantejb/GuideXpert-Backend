'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { OUTBOUND_STATUSES } = require('../constants/chatbotStates');
const { COPILOT_REPLY_STATUSES } = require('../services/chatbot/humanCopilot/humanCopilotConstants');

describe('copilot schema enums', () => {
  test('outbound statuses include simulated', () => {
    assert.ok(OUTBOUND_STATUSES.includes('simulated'));
    assert.ok(OUTBOUND_STATUSES.includes('delivered'));
    assert.ok(OUTBOUND_STATUSES.includes('read'));
  });

  test('copilot reply statuses include full delivery lifecycle', () => {
    for (const status of ['submitted', 'sent', 'delivered', 'read', 'failed', 'simulated']) {
      assert.ok(COPILOT_REPLY_STATUSES.includes(status), `missing ${status}`);
    }
  });
});
