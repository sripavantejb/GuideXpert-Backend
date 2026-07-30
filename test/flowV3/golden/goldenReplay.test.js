'use strict';

/**
 * Golden replay harness — deterministic gates / validators (no live LLM).
 * Cases: crisis, AP-OC-male demographic, grounding block, beat-order fallback.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGateChain } = require('../../../services/chatbot/flowV3LLM/gates/gateChain');
const { validateEnvelope } = require('../../../services/chatbot/flowV3LLM/validate/validateEnvelope');
const { runFallbackLadder } = require('../../../services/chatbot/flowV3LLM/validate/fallbackLadder');
const { processFlowV3Turn } = require('../../../services/chatbot/flowV3LLM/flowV3Dispatcher');

const FIXTURES = path.join(__dirname, 'fixtures');

function loadCase(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
}

describe('flow V3 golden replay', () => {
  test('crisis golden: gate terminates before LLM', async () => {
    const fixture = loadCase('crisis');
    const gate = runGateChain({ text: fixture.inbound });
    assert.equal(gate.passed, false);
    assert.equal(gate.terminal.kind, 'crisis');

    let llmCalled = false;
    const out = await processFlowV3Turn({
      text: fixture.inbound,
      conversationId: 'golden_crisis',
      profile: {},
      mode: 'shadow',
      provider: {
        async chatCompletion() {
          llmCalled = true;
          throw new Error('llm forbidden');
        },
      },
    });
    assert.equal(llmCalled, false);
    assert.ok(out.replyText || out.terminal);
  });

  test('AP-OC-male golden: demographic gate blocks predictor path', () => {
    const fixture = loadCase('ap-oc-male');
    const gate = runGateChain({
      text: fixture.inbound,
      profile: fixture.profile,
    });
    assert.equal(gate.passed, false);
    assert.equal(gate.terminal.kind, 'demographic_blocked');
    assert.ok(gate.terminal.copy && gate.terminal.copy.length > 0);
  });

  test('grounding block golden: college claim without grounding fails V-2', () => {
    const fixture = loadCase('grounding-block');
    const out = validateEnvelope(fixture.envelope, { toolTrace: [] });
    assert.equal(out.ok, false);
    assert.ok(out.violations.some((v) => v.code === 'V-2'));
  });

  test('beat order golden: fallback A asks next slot from empty profile', () => {
    const fixture = loadCase('beat-order');
    const out = runFallbackLadder({
      profile: fixture.profile,
      slotMeta: fixture.slotMeta || {},
      reason: 'parse_failed',
    });
    assert.equal(out.tier, 'A');
    assert.equal(out.intent, 'ask_slot');
    assert.ok(out.slot);
  });
});
