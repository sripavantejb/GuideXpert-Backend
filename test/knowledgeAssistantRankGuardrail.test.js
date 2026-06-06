'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const { UNSUPPORTED_CLAIM_FALLBACK } = require('../services/chatbot/aiGuardrailService');

const assistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const searchPath = require.resolve('../services/chatbot/knowledgeSearchService');
const historyPath = require.resolve('../services/chatbot/conversationHistoryService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const langLogPath = require.resolve('../services/chatbot/knowledgeAssistantLanguageLogService');

describe('knowledgeAssistant rank guardrail hotfix', () => {
  beforeEach(() => {
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'https://example.com/v1';
    process.env.LLM_MODEL = 'test-model';

    [
      assistantPath,
      searchPath,
      historyPath,
      providerPath,
      langLogPath,
    ].forEach((path) => delete require.cache[path]);
  });

  afterEach(() => {
    delete process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    mock.restoreAll();
    [
      assistantPath,
      searchPath,
      historyPath,
      providerPath,
      langLogPath,
    ].forEach((path) => delete require.cache[path]);
  });

  test('does not return unsupported claim fallback when LLM echoes user rank 15000', async () => {
    const searchModule = require(searchPath);
    mock.method(searchModule, 'searchKnowledgeAsync', async () => ({
      results: [{ id: '167', question: 'What are the top careers after CSE?', answer: 'Software roles.' }],
      metrics: { mode: 'hybrid', resultIds: ['167'] },
    }));

    const historyModule = require(historyPath);
    mock.method(historyModule, 'getConversationHistory', async () => []);

    const langLogModule = require(langLogPath);
    mock.method(langLogModule, 'recordKnowledgeAssistantLanguageTurn', async () => {});

    const { OpenAiCompatibleProvider } = require(providerPath);
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => ({
      text: 'With rank 15000, CSE may be possible in some colleges depending on exam and category.',
      model: 'test-model',
    }));

    const { answer } = require(assistantPath);
    const result = await answer({
      inboundText: 'Can I get CSE with rank 15000?',
      conversationId: null,
      leadContext: null,
      languageMetadata: {
        originalMessage: '15000 rank tho CSE vastunda?',
        detectedLanguage: 'te',
        resolvedLanguage: 'te',
        translatedQuery: 'Can I get CSE with rank 15000?',
        translationApplied: true,
      },
    });

    assert.notEqual(result?.text, UNSUPPORTED_CLAIM_FALLBACK);
    assert.equal(result?.guardrailModified, false);
    assert.match(result?.text, /15000/);
  });
});
