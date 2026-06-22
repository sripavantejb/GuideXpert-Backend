'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const scoreModelPath = require.resolve('../models/WhatsAppLeadScore');
const flagsPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFlags');
const agentPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotAgentService');

function mockNoLegacyAgent() {
  const agentSvc = require(agentPath);
  mock.method(agentSvc, 'resolveLegacySlot', async () => null);
}

const HANDOFF_ID = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

describe('humanCopilotService', () => {
  const originalThreshold = process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[flagsPath];
    delete require.cache[agentPath];
    if (originalThreshold === undefined) {
      delete process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD;
    } else {
      process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = originalThreshold;
    }
  });

  function sampleHandoff(overrides = {}) {
    return {
      _id: HANDOFF_ID,
      conversationId: CONVERSATION_ID,
      phone: PHONE,
      productLine: 'guidexpert',
      status: 'open',
      route: 'admin_pool',
      reason: 'user_requested',
      userLastMessage: 'Need counsellor',
      assignedSrCounsellor: null,
      summaryForAgent: 'User asked for human help',
      createdAt: new Date('2026-06-01T10:00:00Z'),
      updatedAt: new Date('2026-06-01T10:00:00Z'),
      internalNotes: [],
      copilotReplies: [],
      auditTrail: [],
      lockVersion: 0,
      ...overrides,
    };
  }

  test('deriveAlertReasons maps handoff reason and hot lead score', () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const { deriveAlertReasons } = require(servicePath);

    assert.deepEqual(deriveAlertReasons({ reason: 'user_requested' }, 50), ['human_requested']);
    assert.deepEqual(deriveAlertReasons({ reason: 'low_confidence' }, 50), ['low_confidence']);
    assert.deepEqual(deriveAlertReasons({ reason: 'user_requested' }, 80), [
      'human_requested',
      'hot_lead',
    ]);
  });

  test('listQueue returns mapped rows with alert reasons', async () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const handoff = sampleHandoff();
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'find', () => ({
      sort() {
        return {
          limit() {
            return { lean: async () => [handoff] };
          },
        };
      },
    }));

    const WhatsAppLeadScore = require(scoreModelPath);
    mock.method(WhatsAppLeadScore, 'find', () => ({
      select() {
        return {
          lean: async () => [{ phone: PHONE, leadScore: 85, leadStage: 'hot' }],
        };
      },
    }));

    const { listQueue } = require(servicePath);
    const items = await listQueue();
    assert.equal(items.length, 1);
    assert.equal(items[0].phone, PHONE);
    assert.ok(items[0].alertReasons.includes('human_requested'));
    assert.ok(items[0].alertReasons.includes('hot_lead'));
  });

  test('assignHandoff rejects invalid SR slot', async () => {
    const { assignHandoff } = require(servicePath);
    const result = await assignHandoff(HANDOFF_ID, 'sr3');
    assert.equal(result.success, false);
    assert.equal(result.error, 'invalid_sr_counsellor');
  });

  test('assignHandoff updates assignedSrCounsellor', async () => {
    mockNoLegacyAgent();
    const handoff = sampleHandoff({ assignedSrCounsellor: 'sr2', lockVersion: 3, status: 'claimed' });
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () =>
        sampleHandoff({ assignedSrCounsellor: null, activeAdminId: null, lockVersion: 2 }),
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => handoff,
    }));

    const WhatsAppLeadScore = require(scoreModelPath);
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => ({ phone: PHONE, leadScore: 40, leadStage: 'warm' }) };
      },
    }));

    const { assignHandoff } = require(servicePath);
    const result = await assignHandoff(HANDOFF_ID, 'sr2', new mongoose.Types.ObjectId());
    assert.equal(result.success, true);
    assert.equal(result.handoff.assignedSrCounsellor, 'sr2');
  });

  test('addInternalNote requires text', async () => {
    const { addInternalNote } = require(servicePath);
    const adminId = new mongoose.Types.ObjectId();
    const result = await addInternalNote(HANDOFF_ID, adminId, '   ');
    assert.equal(result.success, false);
    assert.equal(result.error, 'text_required');
  });

  test('getNotifications returns only items with alerts', async () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const handoffs = [
      sampleHandoff({ _id: new mongoose.Types.ObjectId(), reason: 'user_requested' }),
      sampleHandoff({
        _id: new mongoose.Types.ObjectId(),
        reason: 'other',
        phone: '9123456789',
      }),
    ];

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'find', () => ({
      sort() {
        return {
          limit() {
            return { lean: async () => handoffs };
          },
        };
      },
    }));

    const WhatsAppLeadScore = require(scoreModelPath);
    mock.method(WhatsAppLeadScore, 'find', () => ({
      select() {
        return {
          lean: async () => [
            { phone: PHONE, leadScore: 30, leadStage: 'cold' },
            { phone: '9123456789', leadScore: 30, leadStage: 'cold' },
          ],
        };
      },
    }));

    const { getNotifications } = require(servicePath);
    const items = await getNotifications();
    assert.equal(items.length, 1);
    assert.ok(items[0].alertReasons.includes('human_requested'));
  });

  test('getHandoffMessages delegates to paginated transcript service', async () => {
    const handoff = sampleHandoff();
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({ lean: async () => handoff }));

    const adminPath = require.resolve('../services/chatbot/chatbotAdminService');
    const adminSvc = require(adminPath);
    mock.method(adminSvc, 'getConversationTranscriptPage', async () => ({
      messages: [{ id: '1', direction: 'in', text: 'Hi', at: new Date() }],
      hasMoreOlder: true,
      hasMoreNewer: false,
      oldestCursor: { at: new Date(), id: '1' },
      newestCursor: { at: new Date(), id: '1' },
    }));

    delete require.cache[servicePath];
    const { getHandoffMessages } = require(servicePath);
    const result = await getHandoffMessages(HANDOFF_ID, { limit: 50 });
    assert.equal(result.messages.length, 1);
    assert.equal(result.hasMoreOlder, true);
  });
});
