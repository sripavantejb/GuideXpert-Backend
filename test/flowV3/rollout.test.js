'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveFlowV3Routing,
  phoneCanaryBucket,
  nextCanaryStep,
  CANARY_STEPS,
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

  test('kill switch keeps new conversations on V2', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '0';
    process.env.CHATBOT_FLOW_V3_MODE = 'live';
    process.env.CHATBOT_FLOW_V3_CANARY_PERCENT = '100';
    const out = resolveFlowV3Routing({ phone: '9876543210' });
    assert.equal(out.useV3, false);
    assert.equal(out.reason, 'disabled');
  });

  test('pinned V3 survives kill switch', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '0';
    const out = resolveFlowV3Routing({
      phone: '9876543210',
      pinnedEngine: 'flow_v3',
      pinnedMode: 'live',
    });
    assert.equal(out.useV3, true);
    assert.equal(out.mode, 'live');
    assert.equal(out.reason, 'pinned');
  });

  test('shadow mode enables V3 logging path for all phones', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '1';
    process.env.CHATBOT_FLOW_V3_MODE = 'shadow';
    const out = resolveFlowV3Routing({ phone: '9876543210' });
    assert.equal(out.useV3, true);
    assert.equal(out.mode, 'shadow');
  });

  test('live canary uses stable phone bucket', () => {
    process.env.CHATBOT_FLOW_V3_ENABLED = '1';
    process.env.CHATBOT_FLOW_V3_MODE = 'live';
    process.env.CHATBOT_FLOW_V3_CANARY_PERCENT = '5';
    const phone = '9123456780';
    const bucket = phoneCanaryBucket(phone);
    const out = resolveFlowV3Routing({ phone });
    if (bucket < 5) {
      assert.equal(out.useV3, true);
      assert.equal(out.mode, 'live');
      assert.equal(out.reason, 'canary_hit');
    } else {
      assert.equal(out.useV3, false);
      assert.equal(out.reason, 'canary_miss');
    }
    assert.equal(phoneCanaryBucket(phone), bucket);
  });

  test('canary steps are 5 → 25 → 100', () => {
    assert.deepEqual([...CANARY_STEPS], [5, 25, 100]);
    assert.equal(nextCanaryStep(0), 5);
    assert.equal(nextCanaryStep(5), 25);
    assert.equal(nextCanaryStep(25), 100);
    assert.equal(nextCanaryStep(100), null);
  });

  test('registry exposes career_counselling_flow_v3', () => {
    assert.equal(getGuidedFlowById('career_counselling_flow_v3')?.botState, 'career_counselling_flow_v3');
    assert.equal(
      getGuidedFlowByIntent('career_counselling_flow_v3_continue')?.id,
      'career_counselling_flow_v3'
    );
  });
});
