'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const scoreModelPath = require.resolve('../models/WhatsAppLeadScore');
const agentPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotAgentService');

function mockNoLegacyAgent() {
  const agentSvc = require(agentPath);
  mock.method(agentSvc, 'resolveLegacySlot', async () => null);
}

const HANDOFF_ID = new mongoose.Types.ObjectId();
const ADMIN_A = new mongoose.Types.ObjectId();
const ADMIN_B = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

describe('humanCopilot concurrency', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[agentPath];
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
      assignedSrCounsellor: 'sr1',
      activeAdminId: ADMIN_A,
      lockVersion: 2,
      copilotState: 'assigned',
      internalNotes: [],
      copilotReplies: [],
      auditTrail: [],
      ...overrides,
    };
  }

  test('assignHandoff returns already_assigned when another admin owns lock', async () => {
    mockNoLegacyAgent();
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => sampleHandoff(),
    }));

    const { assignHandoff } = require(servicePath);
    const result = await assignHandoff(HANDOFF_ID, 'sr2', ADMIN_B);
    assert.equal(result.success, false);
    assert.equal(result.error, 'already_assigned');
    assert.equal(result.assignedSrCounsellor, 'sr1');
  });

  test('assignHandoff returns version_conflict when lockVersion mismatches', async () => {
    mockNoLegacyAgent();
    const handoff = sampleHandoff({ assignedSrCounsellor: null, activeAdminId: null, lockVersion: 5 });
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => handoff,
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => null,
    }));

    const { assignHandoff } = require(servicePath);
    const result = await assignHandoff(HANDOFF_ID, 'sr1', ADMIN_A, { lockVersion: 3 });
    assert.equal(result.success, false);
    assert.equal(result.error, 'version_conflict');
    assert.equal(result.lockVersion, 5);
  });

  test('assignHandoff succeeds atomically for unassigned handoff', async () => {
    mockNoLegacyAgent();
    const handoff = sampleHandoff({
      assignedSrCounsellor: 'sr1',
      activeAdminId: ADMIN_A,
      lockVersion: 3,
      status: 'claimed',
    });
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => sampleHandoff({ assignedSrCounsellor: null, activeAdminId: null, lockVersion: 2 }),
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
    const result = await assignHandoff(HANDOFF_ID, 'sr1', ADMIN_A, { lockVersion: 2 });
    assert.equal(result.success, true);
    assert.equal(result.lockVersion, 3);
  });
});
