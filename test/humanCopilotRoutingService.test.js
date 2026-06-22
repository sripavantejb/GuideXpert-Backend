'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const routingPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotRoutingService');
const agentPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotAgentService');
const configPath = require.resolve('../models/HumanCopilotConfig');
const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const handoffPath = require.resolve('../models/WhatsAppAgentHandoff');
const adminPath = require.resolve('../models/Admin');
const scorePath = require.resolve('../models/WhatsAppLeadScore');

const AGENT_A = new mongoose.Types.ObjectId();
const AGENT_B = new mongoose.Types.ObjectId();
const AGENT_C = new mongoose.Types.ObjectId();
const HANDOFF_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();

function agentDoc(id, role, availability, activeCount, extras = {}) {
  return {
    _id: id,
    username: `agent_${String(id).slice(-4)}`,
    name: `Agent ${String(id).slice(-4)}`,
    copilotAgentProfile: {
      enabled: true,
      role,
      availability,
      maxConcurrentConversations: extras.maxConcurrent ?? 5,
      specialties: extras.specialties || [],
      legacySlot: extras.legacySlot || null,
    },
    _activeCount: activeCount,
  };
}

function setupAgentMocks(agents) {
  const agentSvc = require(agentPath);
  mock.method(agentSvc, 'listAgentAdmins', async () => agents);
  mock.method(agentSvc, 'countActiveConversationsForAgent', async (admin) => admin._activeCount ?? 0);
  mock.method(agentSvc, 'isAgentAssignable', (admin, count) => {
    const c = count ?? admin._activeCount ?? 0;
    const max = admin.copilotAgentProfile?.maxConcurrentConversations ?? 5;
    return admin.copilotAgentProfile?.availability !== 'offline' && c < max;
  });
  mock.method(agentSvc, 'mapAgentRow', (admin, count) => ({
    id: String(admin._id),
    name: admin.name,
    role: admin.copilotAgentProfile?.role,
    activeConversations: count ?? admin._activeCount ?? 0,
  }));
}

function setupConfigMock(config) {
  const configMod = require(configPath);
  mock.method(configMod, 'getOrCreateConfig', async () => config);
}

function loadRouting() {
  delete require.cache[routingPath];
  return require(routingPath);
}

describe('humanCopilotRoutingService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[routingPath];
    delete require.cache[agentPath];
    delete require.cache[servicePath];
  });

  test('round robin distributes to next agent after cursor', async () => {
    setupAgentMocks([
      agentDoc(AGENT_A, 'general_counsellor', 'active', 1),
      agentDoc(AGENT_B, 'general_counsellor', 'active', 1),
      agentDoc(AGENT_C, 'general_counsellor', 'active', 1),
    ]);
    setupConfigMock({
      _id: 'default',
      routingMode: 'round_robin',
      roundRobinCursor: AGENT_B,
    });

    const { selectAgentForHandoff } = loadRouting();
    const decision = await selectAgentForHandoff(
      { userLastMessage: 'Hello', productLine: 'guidexpert' },
      { modeOverride: 'round_robin' }
    );
    assert.equal(decision.agentId, String(AGENT_C));
    assert.equal(decision.routingMode, 'round_robin');
    assert.equal(decision.reason, 'round_robin_next');
  });

  test('least workload picks agent with fewest active conversations', async () => {
    setupAgentMocks([
      agentDoc(AGENT_A, 'general_counsellor', 'active', 4),
      agentDoc(AGENT_B, 'general_counsellor', 'active', 1),
    ]);
    setupConfigMock({ _id: 'default', routingMode: 'least_workload' });

    const { selectAgentForHandoff } = loadRouting();
    const decision = await selectAgentForHandoff(
      { userLastMessage: 'General question' },
      { modeOverride: 'least_workload' }
    );
    assert.equal(decision.agentId, String(AGENT_B));
    assert.equal(decision.reason, 'least_workload');
  });

  test('specialty routing assigns IIT expert for IIT topic', async () => {
    setupAgentMocks([
      agentDoc(AGENT_A, 'iit_expert', 'active', 1, { specialties: ['iit'] }),
      agentDoc(AGENT_B, 'general_counsellor', 'active', 1, { specialties: ['general'] }),
    ]);
    setupConfigMock({ _id: 'default', routingMode: 'specialty' });

    const { selectAgentForHandoff } = loadRouting();
    const decision = await selectAgentForHandoff(
      { userLastMessage: 'What IIT branch for rank 5000?', productLine: 'guidexpert' },
      { modeOverride: 'specialty' }
    );
    assert.equal(decision.agentId, String(AGENT_A));
    assert.equal(decision.routingMode, 'specialty');
    assert.ok(decision.reason.includes('iit'));
  });

  test('offline agent is skipped', async () => {
    setupAgentMocks([
      agentDoc(AGENT_A, 'general_counsellor', 'offline', 0),
      agentDoc(AGENT_B, 'general_counsellor', 'active', 1),
    ]);
    setupConfigMock({ _id: 'default', routingMode: 'least_workload' });

    const { selectAgentForHandoff } = loadRouting();
    const decision = await selectAgentForHandoff(
      { userLastMessage: 'Need help' },
      { modeOverride: 'least_workload' }
    );
    assert.equal(decision.agentId, String(AGENT_B));
  });

  test('overload prevention skips at-capacity agent', async () => {
    setupAgentMocks([
      agentDoc(AGENT_A, 'general_counsellor', 'active', 5, { maxConcurrent: 5 }),
      agentDoc(AGENT_B, 'general_counsellor', 'active', 2, { maxConcurrent: 5 }),
    ]);
    setupConfigMock({ _id: 'default', routingMode: 'least_workload' });

    const { selectAgentForHandoff } = loadRouting();
    const decision = await selectAgentForHandoff(
      { userLastMessage: 'Need help' },
      { modeOverride: 'least_workload' }
    );
    assert.equal(decision.agentId, String(AGENT_B));
  });

  test('fallback routing uses general counsellor when no specialist', async () => {
    setupAgentMocks([
      agentDoc(AGENT_B, 'general_counsellor', 'active', 1, { specialties: ['general'] }),
    ]);
    setupConfigMock({ _id: 'default', routingMode: 'specialty' });

    const { selectAgentForHandoff } = loadRouting();
    const decision = await selectAgentForHandoff(
      { userLastMessage: 'What IIT branch for rank 5000?' },
      { modeOverride: 'specialty' }
    );
    assert.equal(decision.agentId, String(AGENT_B));
    assert.equal(decision.reason, 'fallback_general_counsellor');
    assert.equal(decision.fallback?.used, true);
    assert.equal(decision.fallback?.role, 'general_counsellor');
  });

  test('manual assignment override via assignHandoffByAgent', async () => {
    const handoff = {
      _id: HANDOFF_ID,
      conversationId: new mongoose.Types.ObjectId(),
      phone: '9876543210',
      route: 'admin_pool',
      status: 'open',
      copilotReplies: [],
      lockVersion: 0,
    };
    const agentAdmin = {
      _id: AGENT_A,
      username: 'iit1',
      name: 'IIT Expert',
      copilotAgentProfile: { enabled: true, role: 'iit_expert', legacySlot: null },
      _activeCount: 1,
    };

    const Admin = require(adminPath);
    const WhatsAppAgentHandoff = require(handoffPath);
    const WhatsAppLeadScore = require(scorePath);

    mock.method(Admin, 'findById', () => ({
      select() {
        return { lean: async () => agentAdmin };
      },
    }));
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({ lean: async () => handoff }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => ({
        ...handoff,
        assignedAgentId: AGENT_A,
        status: 'claimed',
        lockVersion: 1,
      }),
    }));
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
    }));

    setupAgentMocks([agentAdmin]);

    delete require.cache[servicePath];
    const { assignHandoffByAgent } = require(servicePath);
    const result = await assignHandoffByAgent(HANDOFF_ID, AGENT_A, ADMIN_ID);
    assert.equal(result.success, true);
    assert.equal(result.handoff.assignedAgentId, String(AGENT_A));
  });
});
