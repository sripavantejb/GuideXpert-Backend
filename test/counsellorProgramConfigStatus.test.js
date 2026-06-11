'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getCounsellorProgramAssistantConfigStatus,
} = require('../utils/counsellorProgramConfigStatus');

describe('counsellorProgramConfigStatus', () => {
  const saved = {};

  afterEach(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function setEnv(key, value) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  test('ready when CPA flag and LLM config are set', () => {
    setEnv('CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED', '1');
    setEnv('CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED', '1');
    setEnv('LLM_API_KEY', 'test-key');
    setEnv('LLM_BASE_URL', 'https://integrate.api.nvidia.com/v1');
    setEnv('LLM_MODEL', 'openai/gpt-oss-20b');

    const status = getCounsellorProgramAssistantConfigStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.ready, true);
  });

  test('not ready when CPA flag is off', () => {
    setEnv('CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED', '0');
    setEnv('CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED', '1');
    setEnv('LLM_API_KEY', 'test-key');
    setEnv('LLM_BASE_URL', 'https://integrate.api.nvidia.com/v1');
    setEnv('LLM_MODEL', 'openai/gpt-oss-20b');

    const status = getCounsellorProgramAssistantConfigStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.ready, false);
  });
});
