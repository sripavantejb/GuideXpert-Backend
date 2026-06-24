'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const handoffPath = require.resolve('../services/chatbot/handoffService');
const leadScorePath = require.resolve('../models/WhatsAppLeadScore');

describe('resolveHandoffForCopilot lockVersion', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
  });

  test('rejects resolve when lockVersion mismatches', async () => {
    const HANDOFF_ID = '507f1f77bcf86cd799439011';
    const ADMIN_ID = '507f1f77bcf86cd799439099';

    const existing = {
      _id: HANDOFF_ID,
      route: 'admin_pool',
      status: 'claimed',
      lockVersion: 5,
      phone: '9347763131',
      assignedSrCounsellor: 'sr1',
      copilotReplies: [],
    };

    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => existing,
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => null,
    }));

    const { resolveHandoffForCopilot } = require(servicePath);
    const result = await resolveHandoffForCopilot(HANDOFF_ID, ADMIN_ID, { lockVersion: 3 });
    assert.equal(result.success, false);
    assert.equal(result.error, 'version_conflict');
    assert.equal(result.lockVersion, 5);
  });

  test('resolve succeeds when lockVersion matches', async () => {
    const HANDOFF_ID = '507f1f77bcf86cd799439011';
    const ADMIN_ID = '507f1f77bcf86cd799439099';

    const existing = {
      _id: HANDOFF_ID,
      route: 'admin_pool',
      status: 'claimed',
      lockVersion: 2,
      phone: '9347763131',
      assignedSrCounsellor: 'sr1',
      copilotReplies: [],
    };

    const WhatsAppAgentHandoff = require(handoffModelPath);
    let lockVersion = 2;
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => ({ ...existing, lockVersion }),
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => {
        lockVersion = 3;
        return { ...existing, lockVersion, copilotState: 'resolved' };
      },
    }));

    const handoffModule = require(handoffPath);
    mock.method(handoffModule, 'resolveHandoff', async () => ({ success: true }));

    const WhatsAppLeadScore = require(leadScorePath);
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => null };
      },
    }));

    const { resolveHandoffForCopilot } = require(servicePath);
    const result = await resolveHandoffForCopilot(HANDOFF_ID, ADMIN_ID, { lockVersion: 2 });
    assert.equal(result.success, true);
    assert.equal(result.lockVersion, 3);
  });
});
