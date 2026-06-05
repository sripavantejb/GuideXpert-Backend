'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildContext,
  formatUnifiedContext,
} = require('../services/chatbot/contextBuilderService');

describe('contextBuilderService', () => {
  test('buildContext includes only whitelisted CRM fields and omits sensitive values', () => {
    const context = buildContext({
      leadContext: {
        phone: '9876543210',
        email: 'student@example.com',
        token: 'secret-token',
        password: 'secret-password',
        productLine: 'iit_counselling',
        iit: {
          fullName: 'Test Student',
          assignedBdaName: 'Counsellor A',
          callStatusLabel: 'Interested',
          internalId: 'internal-123',
        },
        gx: {
          rankPredictorLead: { rank: 1234 },
        },
      },
      knowledgeResults: [],
      history: [],
    });

    assert.deepEqual(context.crmContext, {
      name: 'Test Student',
      productLine: 'iit_counselling',
      counsellingStatus: 'Interested',
      assignedCounsellor: 'Counsellor A',
      rankPredictorStatus: 'available',
    });

    const serialized = JSON.stringify(context);
    assert.doesNotMatch(serialized, /9876543210/);
    assert.doesNotMatch(serialized, /student@example\.com/);
    assert.doesNotMatch(serialized, /secret-token/);
    assert.doesNotMatch(serialized, /secret-password/);
    assert.doesNotMatch(serialized, /internal-123/);
  });

  test('formats history transcript and existing knowledge context', () => {
    const context = buildContext({
      leadContext: null,
      history: [
        { role: 'user', content: 'What is NIAT?' },
        { role: 'assistant', content: 'NIAT is an industry-ready program.' },
      ],
      knowledgeResults: [
        {
          id: 15,
          question: 'What exactly is NIAT?',
          answer: 'NIAT prepares students for future technologies.',
        },
      ],
    });
    const unified = formatUnifiedContext(context);

    assert.match(context.conversationContext, /User: What is NIAT\?/);
    assert.match(context.conversationContext, /Assistant: NIAT is an industry-ready program\./);
    assert.match(context.knowledgeContext, /Knowledge Entry 1/);
    assert.match(context.knowledgeContext, /What exactly is NIAT\?/);
    assert.match(unified, /Conversation Context:/);
    assert.match(unified, /Knowledge Context:/);
  });

  test('formatUnifiedContext omits conversation transcript when history is sent separately', () => {
    const context = buildContext({
      leadContext: null,
      history: [{ role: 'user', content: 'What is NIAT?' }],
      knowledgeResults: [],
    });
    const unified = formatUnifiedContext(context, { includeConversationContext: false });

    assert.doesNotMatch(unified, /Conversation Context:/);
    assert.match(unified, /Knowledge Context:/);
  });
});
