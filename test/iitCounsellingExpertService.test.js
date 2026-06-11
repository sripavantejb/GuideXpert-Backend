'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const expertPath = require.resolve('../services/chatbot/iitCounsellingExpert/iitCounsellingExpertService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const knowledgePath = require.resolve(
  '../services/chatbot/iitCounsellingExpert/iitCounsellingKnowledgeService'
);
const historyPath = require.resolve('../services/chatbot/conversationHistoryService');
const flagsPath = require.resolve('../services/chatbot/iitCounsellingExpert/iitCounsellingFlags');

describe('iitCounsellingExpertService reliability', () => {
  const originalEnv = {
    enabled: process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED,
    apiKey: process.env.LLM_API_KEY,
  };

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[expertPath];
    delete require.cache[providerPath];
    delete require.cache[knowledgePath];
    delete require.cache[historyPath];
    delete require.cache[flagsPath];

    if (originalEnv.enabled === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = originalEnv.enabled;
    }
    if (originalEnv.apiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalEnv.apiKey;
    }
  });

  function mockHappyPath({ llmResponses = [] } = {}) {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    delete require.cache[historyPath];
    const historyService = require(historyPath);
    mock.method(historyService, 'getConversationHistory', async () => []);

    delete require.cache[knowledgePath];
    const knowledgeService = require(knowledgePath);
    mock.method(knowledgeService, 'searchIitCounsellingKnowledge', async () => ({
      kbResults: [
        {
          id: 'kb-1',
          question: 'What is OBC-NCL rank?',
          answer: 'OBC-NCL rank is used for OBC-NCL reserved seat allocation.',
        },
      ],
      knowledgeContext: 'Q: What is OBC-NCL rank?\nA: OBC-NCL rank is used for OBC-NCL reserved seat allocation.',
      metrics: { mode: 'keyword', retrievalFallback: 'keyword_merge' },
    }));

    delete require.cache[providerPath];
    const { OpenAiCompatibleProvider } = require(providerPath);
    let callCount = 0;
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => {
      callCount += 1;
      const response = llmResponses[callCount - 1];
      if (response instanceof Error) {
        throw response;
      }
      return response;
    });

    return { getCallCount: () => callCount };
  }

  test('retries LLM once after provider failure', async () => {
    mockHappyPath({
      llmResponses: [
        new Error('provider timeout'),
        { text: 'OBC-NCL rank is your category rank within OBC-NCL.', model: 'test-model' },
      ],
    });

    const { answer } = require(expertPath);
    const result = await answer({ inboundText: 'What is OBC-NCL rank?' });

    assert.match(result.text, /OBC-NCL rank/i);
    assert.equal(result.languageLog.llmAttempts, 2);
    assert.equal(result.languageLog.answerSource, 'llm');
  });

  test('uses grounded KB answer when LLM stays empty', async () => {
    mockHappyPath({
      llmResponses: [{ text: '   ' }, { text: '' }],
    });

    const { answer } = require(expertPath);
    const result = await answer({ inboundText: 'What is OBC-NCL rank?' });

    assert.match(result.text, /OBC-NCL rank is used for OBC-NCL reserved seat allocation/i);
    assert.equal(result.model, 'grounded_kb');
    assert.equal(result.languageLog.answerSource, 'grounded_kb');
  });

  test('answerWithTimeout retries once after timeout', async () => {
    mockHappyPath({
      llmResponses: [
        { text: 'OBC-NCL rank is your category rank within OBC-NCL.', model: 'test-model' },
      ],
    });

    let attempts = 0;
    const expertModule = require(expertPath);
    const originalAnswer = expertModule.answer;
    mock.method(expertModule, 'answer', async (params) => {
      attempts += 1;
      if (attempts === 1) {
        return null;
      }
      return originalAnswer(params);
    });

    const result = await expertModule.answerWithTimeout({
      inboundText: 'What is OBC-NCL rank?',
    });

    assert.match(result.text, /OBC-NCL rank/i);
    assert.equal(attempts, 2);
  });
});
