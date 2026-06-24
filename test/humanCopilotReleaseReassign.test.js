'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const leadScorePath = require.resolve('../models/WhatsAppLeadScore');

describe('humanCopilot release and reassign', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
  });

  test('releaseHandoff clears activeAdminId and records released audit', async () => {
    const HANDOFF_ID = '507f1f77bcf86cd799439011';
    const ADMIN_ID = '507f1f77bcf86cd799439099';

    const existing = {
      _id: HANDOFF_ID,
      route: 'admin_pool',
      status: 'claimed',
      activeAdminId: ADMIN_ID,
      assignedAgentId: ADMIN_ID,
      assignedSrCounsellor: 'sr1',
      lockVersion: 2,
      phone: '9347763131',
      copilotReplies: [],
    };

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => existing,
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => ({
        ...existing,
        activeAdminId: null,
        copilotState: 'assigned',
        lockVersion: 3,
        auditTrail: [{ action: 'released' }],
      }),
    }));

    const WhatsAppLeadScore = require(leadScorePath);
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
    }));

    const { releaseHandoff } = require(servicePath);
    const result = await releaseHandoff(HANDOFF_ID, ADMIN_ID, { lockVersion: 2 });
    assert.equal(result.success, true);
    assert.equal(result.lockVersion, 3);
    assert.equal(result.handoff.activeAdminId, null);
  });

  test('reassignHandoff records reassigned audit with previous assignee', async () => {
    const HANDOFF_ID = '507f1f77bcf86cd799439011';
    const ADMIN_ID = '507f1f77bcf86cd799439099';
    const PREV_AGENT = '507f1f77bcf86cd799439088';
    const NEW_AGENT = '507f1f77bcf86cd799439077';

    const existing = {
      _id: HANDOFF_ID,
      route: 'admin_pool',
      status: 'claimed',
      activeAdminId: ADMIN_ID,
      assignedAgentId: PREV_AGENT,
      assignedSrCounsellor: 'sr1',
      lockVersion: 4,
      phone: '9347763131',
      copilotReplies: [],
      copilotState: 'assigned',
    };

    const agentServicePath = require.resolve(
      '../services/chatbot/humanCopilot/humanCopilotAgentService'
    );
    delete require.cache[agentServicePath];
    const agentService = require(agentServicePath);
    mock.method(agentService, 'resolveLegacySlot', async () => null);
    mock.method(agentService, 'isAgentAssignable', async () => true);
    mock.method(agentService, 'countActiveConversationsForAgent', async () => 0);

    const adminModelPath = require.resolve('../models/Admin');
    const Admin = require(adminModelPath);
    mock.method(Admin, 'findById', () => ({
      select() {
        return {
          lean: async () => ({
            _id: NEW_AGENT,
            name: 'New Agent',
            username: 'new',
            copilotAgentProfile: { enabled: true },
          }),
        };
      },
    }));

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => existing,
    }));

    let auditAction = null;
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', (_filter, update) => ({
      lean: async () => {
        auditAction = update?.$push?.auditTrail?.action;
        return {
          ...existing,
          assignedAgentId: NEW_AGENT,
          lockVersion: 5,
        };
      },
    }));

    const WhatsAppLeadScore = require(leadScorePath);
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
    }));

    const { reassignHandoff } = require(servicePath);
    const result = await reassignHandoff(
      HANDOFF_ID,
      { agentId: NEW_AGENT },
      ADMIN_ID,
      { lockVersion: 4 }
    );
    assert.equal(result.success, true);
    assert.equal(result.lockVersion, 5);
    assert.equal(auditAction, 'reassigned');
  });
});
