'use strict';

/**
 * Phase 10 delivery lifecycle smoke test (offline mocks).
 * Run: node scripts/humanCopilotDeliveryE2E.js
 */

const assert = require('node:assert/strict');
const { mock } = require('node:test');

const outboundModelPath = require.resolve('../models/WhatsAppOutboundMessage');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const syncPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotDeliverySyncService');

async function run() {
  const HANDOFF_ID = '507f1f77bcf86cd799439011';
  const REPLY_ID = '507f1f77bcf86cd799439012';
  const OUTBOUND_ID = '507f1f77bcf86cd799439013';

  const WhatsAppOutboundMessage = require(outboundModelPath);
  mock.method(WhatsAppOutboundMessage, 'findById', () => ({
    lean: async () => ({
      _id: OUTBOUND_ID,
      handoffId: HANDOFF_ID,
      copilotReplyId: REPLY_ID,
      status: 'submitted',
    }),
  }));

  const WhatsAppAgentHandoff = require(handoffModelPath);
  let replyStatus = 'submitted';
  mock.method(WhatsAppAgentHandoff, 'findById', () => ({
    lean: async () => ({
      _id: HANDOFF_ID,
      assignedSrCounsellor: 'sr1',
      copilotReplies: [
        {
          _id: REPLY_ID,
          status: replyStatus,
          outboundMessageId: OUTBOUND_ID,
          adminId: '507f1f77bcf86cd799439099',
        },
      ],
    }),
  }));
  mock.method(WhatsAppAgentHandoff, 'updateOne', async (_filter, update) => {
    if (update?.$set?.['copilotReplies.$.status']) {
      replyStatus = update.$set['copilotReplies.$.status'];
    }
    return { modifiedCount: 1 };
  });

  const { syncCopilotReplyFromOutbound } = require(syncPath);

  let delivered = await syncCopilotReplyFromOutbound({
    outboundId: OUTBOUND_ID,
    status: 'delivered',
  });
  assert.equal(delivered.synced, true);
  assert.equal(replyStatus, 'delivered');

  let read = await syncCopilotReplyFromOutbound({
    outboundId: OUTBOUND_ID,
    status: 'read',
  });
  assert.equal(read.synced, true);
  assert.equal(replyStatus, 'read');

  console.log('✅ humanCopilotDeliveryE2E: assign → send → delivered → read lifecycle OK');
  mock.restoreAll();
}

run().catch((err) => {
  console.error('❌ humanCopilotDeliveryE2E failed', err);
  process.exit(1);
});
