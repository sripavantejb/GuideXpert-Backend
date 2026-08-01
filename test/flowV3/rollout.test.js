'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveFlowV3Routing,
  phoneCanaryBucket,
  nextCanaryStep,
  CANARY_STEPS,
  isFlowV3Enabled,
  getFlowV3Mode,
  getCanaryPercent,
} = require('../../services/chatbot/flowV3LLM/flowV3Rollout');
const { getGuidedFlowById, getGuidedFlowByIntent } = require('../../services/chatbot/guidedFlows/guidedFlowRegistry');

describe('flow V3 rollout', () => {
  const prev = {};

  before(() => {
    for (const key of [
      'CHATBOT_FLOW_V3_ENABLED',
      'CHATBOT_FLOW_V3_MODE',
      'CHATBOT_FLOW_V3_CANARY_PERCENT',
    ]) {
      prev[key] = process.env[key];
    }
  });

  after(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('kill-switch env is ignored — V3 always on', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '0';
    process.env.CHATBOT_FLOW_V3_MODE = 'shadow';
    process.env.CHATBOT_FLOW_V3_CANARY_PERCENT = '0';
    assert.equal(isFlowV3Enabled(), true);
    assert.equal(getFlowV3Mode(), 'live');
    assert.equal(getCanaryPercent(), 100);
    const out = resolveFlowV3Routing({ phone: '9876543210' });
    assert.equal(out.useV3, true);
    assert.equal(out.mode, 'live');
    assert.equal(out.reason, 'forced_live');
  });

  test('pinned V3 reports pinned reason and stays live', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '0';
    const out = resolveFlowV3Routing({
      phone: '9876543210',
      pinnedEngine: 'flow_v3',
      pinnedMode: 'shadow',
    });
    assert.equal(out.useV3, true);
    assert.equal(out.mode, 'live');
    assert.equal(out.reason, 'pinned');
  });

  test('pinned_v2 is ignored — V3 forced live', () => {
    const out = resolveFlowV3Routing({
      phone: '9876543210',
      pinnedEngine: 'flow_v2',
    });
    assert.equal(out.useV3, true);
    assert.equal(out.mode, 'live');
    assert.equal(out.reason, 'forced_live');
  });

  test('shadow / canary env values cannot downgrade routing', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '1';
    process.env.CHATBOT_FLOW_V3_MODE = 'shadow';
    process.env.CHATBOT_FLOW_V3_CANARY_PERCENT = '5';
    const out = resolveFlowV3Routing({ phone: '9123456780' });
    assert.equal(out.useV3, true);
    assert.equal(out.mode, 'live');
    assert.equal(out.reason, 'forced_live');
  });

  test('canary helpers remain stable (ops tooling)', () => {
    assert.deepEqual([...CANARY_STEPS], [5, 25, 100]);
    assert.equal(nextCanaryStep(0), 5);
    assert.equal(nextCanaryStep(5), 25);
    assert.equal(nextCanaryStep(25), 100);
    assert.equal(nextCanaryStep(100), null);
    const phone = '9123456780';
    assert.equal(phoneCanaryBucket(phone), phoneCanaryBucket(phone));
  });

  test('registry exposes career_counselling_flow_v3', () => {
    assert.equal(getGuidedFlowById('career_counselling_flow_v3')?.botState, 'career_counselling_flow_v3');
    assert.equal(
      getGuidedFlowByIntent('career_counselling_flow_v3_continue')?.id,
      'career_counselling_flow_v3'
    );
  });
});
