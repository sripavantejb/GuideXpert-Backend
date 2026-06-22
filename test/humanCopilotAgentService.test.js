'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const agentPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotAgentService');
const adminPath = require.resolve('../models/Admin');
const handoffPath = require.resolve('../models/WhatsAppAgentHandoff');

const AGENT_A = new mongoose.Types.ObjectId();
const AGENT_B = new mongoose.Types.ObjectId();

describe('humanCopilotAgentService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[agentPath];
  });

  function sampleAdmin(id, overrides = {}) {
    return {
      _id: id,
      username: `user_${String(id).slice(-4)}`,
      name: `Agent ${String(id).slice(-4)}`,
      isSuperAdmin: false,
      sectionAccess: ['human-copilot'],
      copilotAgentProfile: {
        enabled: true,
        role: 'general_counsellor',
        availability: 'active',
        maxConcurrentConversations: 5,
        specialties: ['general'],
        legacySlot: null,
      },
      ...overrides,
    };
  }

  test('isAgentAssignable rejects offline agents', () => {
    const { isAgentAssignable } = require(agentPath);
    const admin = sampleAdmin(AGENT_A, {
      copilotAgentProfile: { enabled: true, availability: 'offline', maxConcurrentConversations: 5 },
    });
    assert.equal(isAgentAssignable(admin, 0), false);
  });

  test('isAgentAssignable rejects overloaded agents', () => {
    const { isAgentAssignable } = require(agentPath);
    const admin = sampleAdmin(AGENT_A, {
      copilotAgentProfile: { enabled: true, availability: 'active', maxConcurrentConversations: 3 },
    });
    assert.equal(isAgentAssignable(admin, 3), false);
    assert.equal(isAgentAssignable(admin, 2), true);
  });

  test('countActiveConversations uses assignedAgentId and legacy slot', async () => {
    const Admin = require(adminPath);
    const WhatsAppAgentHandoff = require(handoffPath);
    const admin = sampleAdmin(AGENT_A, {
      copilotAgentProfile: {
        enabled: true,
        availability: 'active',
        maxConcurrentConversations: 5,
        legacySlot: 'sr1',
      },
    });
    mock.method(Admin, 'findById', () => ({
      select() {
        return { lean: async () => admin };
      },
    }));
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async (query) => {
      assert.ok(query.$or);
      return 2;
    });

    const { countActiveConversations } = require(agentPath);
    const count = await countActiveConversations(AGENT_A);
    assert.equal(count, 2);
  });

  test('mapAgentRow computes workload percent', () => {
    const { mapAgentRow } = require(agentPath);
    const row = mapAgentRow(sampleAdmin(AGENT_A), 3);
    assert.equal(row.activeConversations, 3);
    assert.equal(row.capacity, 5);
    assert.equal(row.workloadPercent, 60);
    assert.equal(row.assignable, true);
  });
});
