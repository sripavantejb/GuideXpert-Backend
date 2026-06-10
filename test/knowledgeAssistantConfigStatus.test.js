'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getKnowledgeAssistantConfigStatus,
} = require('../utils/knowledgeAssistantConfigStatus');

describe('knowledgeAssistantConfigStatus', () => {
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

  test('ready when all required vars are set', () => {
    setEnv('CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED', '1');
    setEnv('LLM_API_KEY', 'test-key');
    setEnv('LLM_BASE_URL', 'https://integrate.api.nvidia.com/v1');
    setEnv('LLM_MODEL', 'openai/gpt-oss-20b');

    const status = getKnowledgeAssistantConfigStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.llmKeyPresent, true);
    assert.equal(status.ready, true);
  });

  test('not ready when LLM key is missing', () => {
    setEnv('CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED', '1');
    setEnv('LLM_API_KEY', '');
    setEnv('LLM_BASE_URL', 'https://integrate.api.nvidia.com/v1');
    setEnv('LLM_MODEL', 'openai/gpt-oss-20b');

    const status = getKnowledgeAssistantConfigStatus();
    assert.equal(status.ready, false);
    assert.equal(status.llmKeyPresent, false);
  });
});
