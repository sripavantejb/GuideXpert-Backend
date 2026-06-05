'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const { OpenAiCompatibleProvider } = require('../services/ai/providers/OpenAiCompatibleProvider');
const {
  answer,
  normalizeHistoryForProvider,
} = require('../services/chatbot/knowledgeAssistantService');

function findChain(rows) {
  let max = rows.length;
  return {
    sort() {
      return this;
    },
    limit(n) {
      max = n;
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(rows.slice(0, max));
    },
  };
}

const ORIGINAL_ENV = {
  CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED: process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED,
  CHATBOT_LLM_ENABLED: process.env.CHATBOT_LLM_ENABLED,
  LLM_API_KEY: process.env.LLM_API_KEY,
  KNOWLEDGE_SEARCH_MODE: process.env.KNOWLEDGE_SEARCH_MODE,
};

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('knowledgeAssistantService', () => {
  test('sends prior conversation turns and unified CRM context to NVIDIA', async () => {
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.KNOWLEDGE_SEARCH_MODE = 'keyword';

    let capturedMessages = null;
    mock.method(OpenAiCompatibleProvider.prototype, 'chatCompletion', async ({ messages }) => {
      capturedMessages = messages;
      return {
        text: 'NIAT is different because it focuses on practical industry readiness.',
        model: 'test-model',
      };
    });
    mock.method(WhatsAppInboundMessage, 'find', () =>
      findChain([
        {
          messageType: 'text',
          text: 'How is it different?',
          receivedAt: new Date('2026-06-04T10:02:00.000Z'),
        },
        {
          messageType: 'text',
          text: 'What is NIAT?',
          receivedAt: new Date('2026-06-04T10:00:00.000Z'),
        },
      ])
    );
    mock.method(WhatsAppOutboundMessage, 'find', () =>
      findChain([
        {
          messageType: 'text',
          content: { text: 'NIAT is an industry-ready upskilling program.' },
          createdAt: new Date('2026-06-04T10:01:00.000Z'),
        },
      ])
    );

    const { answer: answerFn } = require('../services/chatbot/knowledgeAssistantService');
    const result = await answerFn({
      inboundText: 'How is it different?',
      conversationId: 'convo1',
      leadContext: {
        productLine: 'iit_counselling',
        iit: {
          fullName: 'Test Student',
          assignedBdaName: 'Counsellor A',
          callStatusLabel: 'Interested',
        },
      },
    });

    assert.equal(result.text, 'NIAT is different because it focuses on practical industry readiness.');
    assert.ok(capturedMessages);
    assert.equal(capturedMessages[0].role, 'system');
    assert.equal(capturedMessages[1].role, 'system');
    assert.match(capturedMessages[1].content, /Unified Context/);
    assert.match(capturedMessages[1].content, /name: Test Student/);
    assert.match(capturedMessages[1].content, /assignedCounsellor: Counsellor A/);
    assert.doesNotMatch(capturedMessages[1].content, /Conversation Context:/);
    assert.deepEqual(capturedMessages.slice(2), [
      { role: 'user', content: 'What is NIAT?' },
      { role: 'assistant', content: 'NIAT is an industry-ready upskilling program.' },
      { role: 'user', content: 'How is it different?' },
    ]);
  });

  test('normalizeHistoryForProvider merges consecutive duplicate roles', () => {
    const normalized = normalizeHistoryForProvider([
      { role: 'user', content: 'What is NIAT?' },
      { role: 'user', content: 'What is NIAT?' },
      { role: 'assistant', content: 'NIAT is an industry-ready upskilling program.' },
    ]);

    assert.deepEqual(normalized, [
      { role: 'user', content: 'What is NIAT?' },
      { role: 'assistant', content: 'NIAT is an industry-ready upskilling program.' },
    ]);
  });
});
