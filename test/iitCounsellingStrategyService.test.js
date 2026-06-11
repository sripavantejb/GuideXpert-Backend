'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const expertPath = require.resolve('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const knowledgePath = require.resolve(
  '../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyKnowledgeService'
);
const historyPath = require.resolve('../services/chatbot/conversationHistoryService');
const flagsPath = require.resolve('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyFlags');
const iceFlagsPath = require.resolve('../services/chatbot/iitCounsellingExpert/iitCounsellingFlags');

describe('iitCounsellingStrategyService reliability', () => {
  const originalEnv = {
    ice: process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED,
    strategy: process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED,
    apiKey: process.env.LLM_API_KEY,
  };

  afterEach(() => {
    mock.restoreAll();
    [
      expertPath,
      providerPath,
      knowledgePath,
      historyPath,
      flagsPath,
      iceFlagsPath,
    ].forEach((p) => delete require.cache[p]);

    if (originalEnv.ice === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = originalEnv.ice;
    }
    if (originalEnv.strategy === undefined) {
      delete process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED;
    } else {
      process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = originalEnv.strategy;
    }
    if (originalEnv.apiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalEnv.apiKey;
    }
  });

  function mockHappyPath({ llmResponses = [] } = {}) {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    delete require.cache[historyPath];
    const historyService = require(historyPath);
    mock.method(historyService, 'getConversationHistory', async () => []);

    delete require.cache[knowledgePath];
    const knowledgeService = require(knowledgePath);
    mock.method(knowledgeService, 'searchIitCounsellingStrategyKnowledge', async () => ({
      kbResults: [
        {
          id: 'kb-1',
          question: 'CSE vs ECE?',
          answer: 'Choose CSE for software; ECE for electronics pathways.',
        },
      ],
      knowledgeContext: 'Q: CSE vs ECE?\nA: Choose CSE for software; ECE for electronics pathways.',
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
        { text: 'If you enjoy coding, CSE is usually the better fit.', model: 'test-model' },
      ],
    });

    const { answer } = require(expertPath);
    const result = await answer({ inboundText: 'CSE vs ECE?' });

    assert.match(result.text, /CSE/i);
    assert.equal(result.languageLog.llmAttempts, 2);
    assert.equal(result.languageLog.answerSource, 'llm');
  });

  test('prefers grounded KB for coding preference without calling LLM', async () => {
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    delete require.cache[historyPath];
    const historyService = require(historyPath);
    mock.method(historyService, 'getConversationHistory', async () => []);

    delete require.cache[knowledgePath];
    const knowledgeService = require(knowledgePath);
    mock.method(knowledgeService, 'searchIitCounsellingStrategyKnowledge', async () => ({
      kbResults: [
        {
          id: 'kb-coding',
          question: 'Coding pasand ho to — which branch should I choose?',
          answer:
            'If you like coding, CSE or IT is usually the better fit because the core curriculum is software-focused.',
        },
      ],
      knowledgeContext:
        'Q: Coding pasand ho to — which branch should I choose?\nA: If you like coding, CSE or IT is usually the better fit because the core curriculum is software-focused.',
      metrics: { mode: 'keyword', retrievalFallback: 'topic' },
    }));

    delete require.cache[providerPath];
    const { OpenAiCompatibleProvider } = require(providerPath);
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => {
      throw new Error('should not call LLM');
    });

    const { answer } = require(expertPath);
    const result = await answer({ inboundText: 'Coding pasand ho to?' });

    assert.match(result.text, /CSE or IT/i);
    assert.equal(result.model, 'grounded_kb');
    assert.equal(result.languageLog.answerSource, 'grounded_kb');
    assert.equal(result.languageLog.llmAttempts, 0);
  });

  test('replaces generic assistant LLM output with grounded KB', async () => {
    mockHappyPath({
      llmResponses: [
        { text: 'Yes, I can help you with coding questions any time.', model: 'test-model' },
        { text: 'Yes, I can help you with coding questions any time.', model: 'test-model' },
      ],
    });

    const { answer } = require(expertPath);
    const result = await answer({ inboundText: 'CSE vs ECE?' });

    assert.match(result.text, /Choose CSE for software/i);
    assert.equal(result.languageLog.answerSource, 'grounded_kb');
  });

  test('uses grounded KB answer when LLM stays empty', async () => {
    mockHappyPath({
      llmResponses: [{ text: '   ' }, { text: '' }],
    });

    const { answer } = require(expertPath);
    const result = await answer({ inboundText: 'CSE vs ECE?' });

    assert.match(result.text, /Choose CSE for software/i);
    assert.equal(result.model, 'grounded_kb');
    assert.equal(result.languageLog.answerSource, 'grounded_kb');
  });
});
