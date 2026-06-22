'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const copilotPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const replyPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotReplyService');
const handoffPath = require.resolve('../services/chatbot/handoffService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');

const HANDOFF_ID = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();

describe('humanCopilot handoff flow', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[copilotPath];
    delete require.cache[replyPath];
    delete require.cache[handoffPath];
    delete require.cache[require.resolve('../services/chatbot/humanCopilot/humanCopilotRoutingService')];
    delete require.cache[require.resolve('../services/chatbot/humanCopilot/humanCopilotAgentService')];
  });

  test('maybeAutoAssign uses legacy sr round robin when no agents configured', async () => {
    process.env.CHATBOT_COPILOT_AUTO_ASSIGN = '1';
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const agentSvc = require(require.resolve('../services/chatbot/humanCopilot/humanCopilotAgentService'));
    mock.method(agentSvc, 'hasConfiguredAgents', async () => false);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => ({
        _id: HANDOFF_ID,
        route: 'admin_pool',
        assignedSrCounsellor: null,
        assignedAgentId: null,
      }),
    }));
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async () => 4);
    mock.method(WhatsAppAgentHandoff, 'findByIdAndUpdate', async () => ({
      _id: HANDOFF_ID,
      assignedSrCounsellor: 'sr1',
    }));

    delete require.cache[copilotPath];
    delete require.cache[require.resolve('../services/chatbot/humanCopilot/humanCopilotRoutingService')];
    const { maybeAutoAssign } = require(copilotPath);
    const result = await maybeAutoAssign(HANDOFF_ID);
    assert.equal(result.assignedSrCounsellor, 'sr1');
  });

  test('sendReply delegates to sendCopilotReply', async () => {
    const replyModule = require(replyPath);
    mock.method(replyModule, 'sendCopilotReply', async () => ({
      success: true,
      deliveryStatus: 'sent',
      replyId: 'reply-1',
      lockVersion: 2,
    }));

    delete require.cache[copilotPath];
    const { sendReply } = require(copilotPath);
    const result = await sendReply(HANDOFF_ID, ADMIN_ID, 'Thanks for reaching out.');
    assert.equal(result.success, true);
    assert.equal(result.deliveryStatus, 'sent');
    assert.equal(replyModule.sendCopilotReply.mock.calls.length, 1);
  });

  test('resolveHandoffForCopilot delegates to handoffService.resolveHandoff', async () => {
    const handoff = {
      _id: HANDOFF_ID,
      conversationId: CONVERSATION_ID,
      phone: '9876543210',
      route: 'admin_pool',
      status: 'claimed',
      assignedSrCounsellor: 'sr1',
    };

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => ({ ...handoff, copilotReplies: [], auditTrail: [] }),
    }));
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const handoffModule = require(handoffPath);
    mock.method(handoffModule, 'resolveHandoff', async () => ({
      success: true,
      handoff: { ...handoff, status: 'resolved' },
    }));

    const scoreModelPath = require.resolve('../models/WhatsAppLeadScore');
    const WhatsAppLeadScore = require(scoreModelPath);
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
    }));

    delete require.cache[copilotPath];
    const { resolveHandoffForCopilot } = require(copilotPath);
    const result = await resolveHandoffForCopilot(HANDOFF_ID, ADMIN_ID);
    assert.equal(result.success, true);
    assert.equal(handoffModule.resolveHandoff.mock.calls.length, 1);
  });
});
