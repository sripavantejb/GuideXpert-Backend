'use strict';

const { describe, test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const assistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const searchPath = require.resolve('../services/chatbot/knowledgeSearchService');
const historyPath = require.resolve('../services/chatbot/conversationHistoryService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const langLogPath = require.resolve('../services/chatbot/knowledgeAssistantLanguageLogService');

describe('multilingualKnowledgeAssistant integration', () => {
  let searchQuery;

  beforeEach(() => {
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'https://example.com/v1';
    process.env.LLM_MODEL = 'test-model';
    searchQuery = null;

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

  test('searchKnowledgeAsync receives English query from translated inbound', async () => {
    const searchModule = require(searchPath);
    mock.method(searchModule, 'searchKnowledgeAsync', async (query) => {
      searchQuery = query;
      return {
        results: [{ id: '1', question: 'CSE cutoff', answer: 'Depends on college.' }],
        metrics: { mode: 'hybrid', resultIds: ['1'] },
      };
    });

    const historyModule = require(historyPath);
    mock.method(historyModule, 'getConversationHistory', async () => []);

    const langLogModule = require(langLogPath);
    mock.method(langLogModule, 'recordKnowledgeAssistantLanguageTurn', async () => {});

    const { OpenAiCompatibleProvider } = require(providerPath);
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => ({
      text: 'CSE may be possible around rank 15000 depending on the college.',
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

    assert.equal(searchQuery, 'Can I get CSE with rank 15000?');
    assert.ok(result?.text);
    assert.equal(result.languageLog.translatedQuery, 'Can I get CSE with rank 15000?');
    assert.equal(result.languageLog.detectedLanguage, 'te');
  });
});
