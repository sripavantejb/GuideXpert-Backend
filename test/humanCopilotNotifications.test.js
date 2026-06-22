'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const flagsPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFlags');

const HANDOFF_ID = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();

describe('humanCopilot notifications and reopen', () => {
  const originalThreshold = process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD;

  afterEach(() => {
    delete require.cache[servicePath];
    delete require.cache[flagsPath];
    if (originalThreshold === undefined) {
      delete process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD;
    } else {
      process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = originalThreshold;
    }
  });

  test('deriveAlertReasons includes reopened and avoids unrelated alerts', () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const { deriveAlertReasons } = require(servicePath);

    assert.deepEqual(
      deriveAlertReasons({ reason: 'reopened', isReopened: true, copilotState: 'reopened' }, 40),
      ['reopened']
    );
    assert.deepEqual(deriveAlertReasons({ reason: 'bot_escalation' }, 40), []);
    assert.deepEqual(deriveAlertReasons({ reason: 'user_requested' }, 85), [
      'human_requested',
      'hot_lead',
    ]);
  });
});
