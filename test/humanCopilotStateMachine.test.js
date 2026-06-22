'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  canTransitionCopilotState,
  inferCopilotState,
  COPILOT_STATE_TRANSITIONS,
} = require('../services/chatbot/humanCopilot/humanCopilotConstants');

describe('humanCopilot state machine', () => {
  test('pending can transition to assigned and active', () => {
    assert.equal(canTransitionCopilotState('pending', 'assigned'), true);
    assert.equal(canTransitionCopilotState('pending', 'active'), true);
    assert.equal(canTransitionCopilotState('pending', 'resolved'), true);
    assert.equal(canTransitionCopilotState('pending', 'reopened'), false);
  });

  test('active can only transition to resolved', () => {
    assert.equal(canTransitionCopilotState('active', 'resolved'), true);
    assert.equal(canTransitionCopilotState('active', 'pending'), false);
  });

  test('resolved can transition to reopened', () => {
    assert.equal(canTransitionCopilotState('resolved', 'reopened'), true);
    assert.equal(canTransitionCopilotState('resolved', 'pending'), true);
  });

  test('inferCopilotState maps legacy handoff rows', () => {
    assert.equal(inferCopilotState({ status: 'resolved' }), 'resolved');
    assert.equal(
      inferCopilotState({ status: 'claimed', assignedSrCounsellor: 'sr1' }),
      'assigned'
    );
    assert.equal(
      inferCopilotState({
        status: 'claimed',
        assignedSrCounsellor: 'sr1',
        lastAgentMessageAt: new Date(),
      }),
      'active'
    );
    assert.equal(inferCopilotState({ reason: 'reopened', status: 'open' }), 'reopened');
  });

  test('all copilot states have transition table entries', () => {
    for (const state of Object.keys(COPILOT_STATE_TRANSITIONS)) {
      assert.ok(Array.isArray(COPILOT_STATE_TRANSITIONS[state]));
    }
  });
});
