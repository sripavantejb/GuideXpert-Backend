'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotSuggestService');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const transcriptPath = require.resolve('../services/chatbot/chatbotAdminService');
const leadInsightsPath = require.resolve('../services/chatbot/leadInsights/leadInsightsService');
const leadContextPath = require.resolve('../services/chatbot/leadContextService');
const flagsPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFlags');

const CONVERSATION_ID = new mongoose.Types.ObjectId();

describe('humanCopilotSuggestService', () => {
  const originalSuggest = process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED;
  const originalLlmKey = process.env.LLM_API_KEY;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[flagsPath];
    if (originalSuggest === undefined) {
      delete process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED;
    } else {
      process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = originalSuggest;
    }
    if (originalLlmKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalLlmKey;
    }
  });

  test('returns disabled when suggested replies flag is off', async () => {
    process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = '0';
    const { generateSuggestedReplies } = require(servicePath);
    const result = await generateSuggestedReplies({
      handoff: { conversationId: CONVERSATION_ID, phone: '9876543210' },
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'suggested_replies_disabled');
  });

  test('generateSuggestedReplies returns graceful error when llm key missing', async () => {
    process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = '1';
    delete process.env.LLM_API_KEY;
    delete require.cache[servicePath];
    const { generateSuggestedReplies } = require(servicePath);
    const result = await generateSuggestedReplies({
      handoff: { conversationId: CONVERSATION_ID, phone: '9876543210' },
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'llm_not_configured');
  });

  test('formatTranscriptForPrompt labels agent and user messages', () => {
    const { formatTranscriptForPrompt } = require(servicePath);
    const block = formatTranscriptForPrompt([
      { direction: 'in', text: 'Hello' },
      { direction: 'out', senderType: 'agent', text: 'Hi there' },
      { direction: 'out', senderType: 'bot', text: 'Bot reply' },
    ]);
    assert.match(block, /User: Hello/);
    assert.match(block, /Counsellor: Hi there/);
    assert.match(block, /Assistant: Bot reply/);
  });

  test('generateSuggestedReplies returns suggestion shape when LLM succeeds', async () => {
    process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';

    const transcriptModule = require(transcriptPath);
    mock.method(transcriptModule, 'getConversationTranscript', async () => ({
      messages: [{ direction: 'in', text: 'Need help with IIT counselling' }],
    }));

    const leadContextModule = require(leadContextPath);
    mock.method(leadContextModule, 'buildLeadContext', async () => ({
      phone: '9876543210',
      productLine: 'iit',
    }));

    const leadInsightsModule = require(leadInsightsPath);
    mock.method(leadInsightsModule, 'getLeadDetails', async () => ({
      name: 'Ravi',
      profile: { exam: 'JEE', branchInterest: 'CSE' },
      score: { leadScore: 72, leadStage: 'warm', scoreReasons: ['demo_interest'] },
      recentEvents: [{ events: [{ type: 'demo_interest', value: 'yes' }], createdAt: new Date() }],
    }));

    const { OpenAiCompatibleProvider } = require(providerPath);
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async () => ({
      text: 'Happy to help with IIT counselling options.',
      model: 'gpt-test',
    }));

    delete require.cache[servicePath];
    const { generateSuggestedReplies } = require(servicePath);
    const result = await generateSuggestedReplies({
      handoff: {
        conversationId: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit',
        summaryForAgent: 'User needs counselling guidance',
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.suggestions.length, 1);
    assert.match(result.suggestions[0].text, /IIT counselling/);
    assert.equal(result.contextUsed.hasProfile, true);
    assert.equal(result.contextUsed.hasScore, true);
  });
});
