'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const outboundModelPath = require.resolve('../models/WhatsAppOutboundMessage');
const syncPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotDeliverySyncService');

describe('humanCopilotDeliverySyncService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[syncPath];
  });

  test('syncCopilotReplyFromOutbound advances reply to delivered and pushes audit', async () => {
    const HANDOFF_ID = '507f1f77bcf86cd799439011';
    const REPLY_ID = '507f1f77bcf86cd799439012';
    const OUTBOUND_ID = '507f1f77bcf86cd799439013';

    const WhatsAppOutboundMessage = require(outboundModelPath);
    mock.method(WhatsAppOutboundMessage, 'findById', () => ({
      lean: async () => ({
        _id: OUTBOUND_ID,
        handoffId: HANDOFF_ID,
        copilotReplyId: REPLY_ID,
      }),
    }));

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => ({
        _id: HANDOFF_ID,
        assignedSrCounsellor: 'sr1',
        copilotReplies: [
          {
            _id: REPLY_ID,
            status: 'submitted',
            outboundMessageId: OUTBOUND_ID,
            adminId: '507f1f77bcf86cd799439099',
          },
        ],
      }),
    }));

    let updateArg = null;
    mock.method(WhatsAppAgentHandoff, 'updateOne', async (filter, update) => {
      updateArg = update;
      return { modifiedCount: 1 };
    });

    const { syncCopilotReplyFromOutbound } = require(syncPath);
    const result = await syncCopilotReplyFromOutbound({
      outboundId: OUTBOUND_ID,
      status: 'delivered',
      transitionAt: new Date('2026-06-23T12:00:00Z'),
    });

    assert.equal(result.synced, true);
    assert.equal(result.status, 'delivered');
    assert.equal(updateArg.$set['copilotReplies.$.status'], 'delivered');
    assert.equal(updateArg.$push.auditTrail.action, 'reply_delivered');
  });

  test('syncCopilotReplyFromOutbound does not downgrade read to delivered', async () => {
    const HANDOFF_ID = '507f1f77bcf86cd799439011';
    const REPLY_ID = '507f1f77bcf86cd799439012';
    const OUTBOUND_ID = '507f1f77bcf86cd799439013';

    const WhatsAppOutboundMessage = require(outboundModelPath);
    mock.method(WhatsAppOutboundMessage, 'findById', () => ({
      lean: async () => ({
        _id: OUTBOUND_ID,
        handoffId: HANDOFF_ID,
        copilotReplyId: REPLY_ID,
      }),
    }));

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => ({
        _id: HANDOFF_ID,
        copilotReplies: [{ _id: REPLY_ID, status: 'read', outboundMessageId: OUTBOUND_ID }],
      }),
    }));
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({ modifiedCount: 0 }));

    const { syncCopilotReplyFromOutbound } = require(syncPath);
    const result = await syncCopilotReplyFromOutbound({
      outboundId: OUTBOUND_ID,
      status: 'delivered',
    });

    assert.equal(result.synced, false);
    assert.equal(result.status, 'read');
  });
});
