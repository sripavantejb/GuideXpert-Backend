'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { HANDOFF_REASONS } = require('../constants/chatbotStates');
const { preserveCrisisLock, isStateExpired } = require('../services/chatbot/botStateService');
const { emptySubflows } = require('../services/chatbot/botSubflowContext');
const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');

describe('crisis handoff reason enum', () => {
  test('crisis_escalation is an accepted handoff reason', () => {
    assert.ok(HANDOFF_REASONS.includes('crisis_escalation'));
  });

  test('a crisis handoff document validates', async () => {
    const doc = new WhatsAppAgentHandoff({
      conversationId: new mongoose.Types.ObjectId(),
      phone: '9876543210',
      reason: 'crisis_escalation',
      createdBy: 'bot',
      expiresAt: null,
    });
    await doc.validate();
    assert.equal(doc.reason, 'crisis_escalation');
    assert.equal(doc.expiresAt, null);
  });

  test('crisis stays distinguishable from ordinary bot escalation', () => {
    assert.notEqual('crisis_escalation', 'bot_escalation');
    assert.ok(HANDOFF_REASONS.includes('bot_escalation'));
  });

  test('an invalid reason is still rejected — the enum is not loosened', async () => {
    const doc = new WhatsAppAgentHandoff({
      conversationId: new mongoose.Types.ObjectId(),
      phone: '9876543210',
      reason: 'not_a_real_reason',
      createdBy: 'bot',
    });
    await assert.rejects(() => doc.validate(), (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.ok(err.errors.reason);
      return true;
    });
  });
});

describe('crisis lock survives subflow expiry', () => {
  const lockedState = () => ({
    state: 'human_handoff',
    stateExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    context: {
      flowV2: {
        stage: 'crisis',
        profile: { crisisLocked: true, crisisHandoffId: 'ticket-abc', name: 'Asha' },
      },
      college: { some: 'subflow' },
    },
  });

  test('the state is genuinely expired in this fixture', () => {
    assert.equal(isStateExpired(lockedState()), true);
  });

  test('the rebuilt context after expiry still carries the lock', () => {
    const preserved = preserveCrisisLock(lockedState());
    const rebuilt = { ...emptySubflows(), ...preserved };

    assert.equal(rebuilt.flowV2.profile.crisisLocked, true);
    assert.equal(rebuilt.flowV2.profile.crisisHandoffId, 'ticket-abc');
    // Everything else still resets — this fixes the lock, not the TTL.
    assert.deepEqual(rebuilt.college, {});
    assert.equal(rebuilt.knowledgeAssistantActive, false);
  });

  test('a student who was never locked gets a clean reset', () => {
    const unlocked = {
      context: { flowV2: { profile: { crisisLocked: false, name: 'Ravi' } } },
    };
    assert.deepEqual(preserveCrisisLock(unlocked), {});
    assert.deepEqual({ ...emptySubflows(), ...preserveCrisisLock(unlocked) }, emptySubflows());
  });

  test('missing or malformed state never throws and never invents a lock', () => {
    assert.deepEqual(preserveCrisisLock(null), {});
    assert.deepEqual(preserveCrisisLock({}), {});
    assert.deepEqual(preserveCrisisLock({ context: {} }), {});
    assert.deepEqual(preserveCrisisLock({ context: { flowV2: null } }), {});
    assert.deepEqual(preserveCrisisLock({ context: { flowV2: { profile: null } } }), {});
  });

  test('the lock can never be turned off by the preserved patch', () => {
    const sneaky = {
      context: { flowV2: { profile: { crisisLocked: true, crisisHandoffId: null } } },
    };
    assert.equal(preserveCrisisLock(sneaky).flowV2.profile.crisisLocked, true);
  });
});
