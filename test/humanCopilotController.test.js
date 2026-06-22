'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const middlewarePath = require.resolve('../middleware/requireHumanCopilot');
const flagsPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFlags');
const configPath = require.resolve('../utils/humanCopilotConfigStatus');

describe('humanCopilot gating', () => {
  const originalFlag = process.env.CHATBOT_HUMAN_COPILOT_ENABLED;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[middlewarePath];
    delete require.cache[flagsPath];
    delete require.cache[configPath];
    if (originalFlag === undefined) {
      delete process.env.CHATBOT_HUMAN_COPILOT_ENABLED;
    } else {
      process.env.CHATBOT_HUMAN_COPILOT_ENABLED = originalFlag;
    }
  });

  test('requireHumanCopilot returns 503 when master flag is off', () => {
    process.env.CHATBOT_HUMAN_COPILOT_ENABLED = '0';
    const { requireHumanCopilot } = require(middlewarePath);

    let statusCode = null;
    let body = null;
    const req = {};
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
      },
    };
    let nextCalled = false;

    requireHumanCopilot(req, res, () => {
      nextCalled = true;
    });

    assert.equal(statusCode, 503);
    assert.equal(body.success, false);
    assert.match(body.message, /disabled/i);
    assert.equal(nextCalled, false);
  });

  test('requireHumanCopilot calls next when enabled', () => {
    process.env.CHATBOT_HUMAN_COPILOT_ENABLED = '1';
    const { requireHumanCopilot } = require(middlewarePath);

    let nextCalled = false;
    requireHumanCopilot({}, { status: () => ({ json: () => {} }) }, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  test('getHumanCopilotHealthStatus exposes queue and notification health flags', async () => {
    process.env.CHATBOT_HUMAN_COPILOT_ENABLED = '1';
    const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async () => 3);

    const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
    mock.method(require(servicePath), 'getNotifications', async () => []);

    delete require.cache[configPath];
    const { getHumanCopilotHealthStatus } = require(configPath);
    const status = await getHumanCopilotHealthStatus();
    assert.equal(status.queueHealthy, true);
    assert.equal(status.notificationsHealthy, true);
  });
});
