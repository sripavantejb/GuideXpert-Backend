'use strict';

/**
 * F-8 regression — V-8 beat discipline is a real BLOCK.
 *
 * The previous implementation computed the patch keys and threw them away
 * (`void targets`). An ask_slot envelope that asks a DIFFERENT named slot
 * than the deterministic walk selected must block — one beat ahead, in order,
 * never two.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEnvelope,
  detectAskedSlots,
} = require('../../services/chatbot/flowV3LLM/validate/validateEnvelope');

function askEnvelope(body) {
  return {
    intent: 'ask_slot',
    parts: [{ type: 'text', body }],
    grounding: [],
    profile_patch: {},
    booking_url_slot: null,
  };
}

describe('F-8: V-8 beat discipline blocks out-of-order asks', () => {
  test('asking budget when the walk expects qualification is BLOCKED', () => {
    const out = validateEnvelope(askEnvelope("What's your budget, comfortable for your family?"), {
      toolTrace: [],
      nextSlotHint: { slot: 'qualification', beat: 'B1', askable: true },
    });
    assert.equal(out.ok, false);
    assert.ok(
      out.violations.some((v) => v.code === 'V-8' && String(v.detail).includes('asked=budgetBand')),
      `expected V-8 beat_discipline, got ${JSON.stringify(out.violations)}`
    );
  });

  test('asking the EXPECTED slot passes', () => {
    const out = validateEnvelope(askEnvelope('First, may I know your current qualification?'), {
      toolTrace: [],
      nextSlotHint: { slot: 'qualification', beat: 'B1', askable: true },
    });
    assert.equal(out.ok, true, `unexpected violations: ${JSON.stringify(out.violations)}`);
  });

  test('a generic coaching line with no named slot passes (conservative)', () => {
    const out = validateEnvelope(askEnvelope('Tell me a little more about yourself.'), {
      toolTrace: [],
      nextSlotHint: { slot: 'qualification', beat: 'B1', askable: true },
    });
    assert.equal(out.ok, true, `unexpected violations: ${JSON.stringify(out.violations)}`);
  });

  test('ambiguous multi-slot text does not block (conservative by design)', () => {
    const out = validateEnvelope(
      askEnvelope('What matters to you most — budget, or which city you study in?'),
      {
        toolTrace: [],
        nextSlotHint: { slot: 'goalPriority', beat: 'B1', askable: true },
      }
    );
    assert.equal(out.ok, true, `unexpected violations: ${JSON.stringify(out.violations)}`);
  });

  test('non-ask_slot intents are exempt from V-8', () => {
    const out = validateEnvelope(
      {
        intent: 'answer_question',
        parts: [{ type: 'text', body: 'Fees vary — what is comfortable for your family?' }],
        grounding: [],
        profile_patch: {},
        booking_url_slot: null,
      },
      { toolTrace: [], nextSlotHint: { slot: 'qualification' } }
    );
    assert.ok(!out.violations.some((v) => v.code === 'V-8'));
  });
});

describe('F-8: asked-slot detection', () => {
  test('maps distinctive V2 question vocabulary to slots', () => {
    assert.deepEqual(detectAskedSlots('First, may I know your current qualification?'), [
      'qualification',
    ]);
    assert.deepEqual(detectAskedSlots('Near home, or open to moving?'), ['cityPref']);
    assert.deepEqual(detectAskedSlots('What are you looking for ?'), ['goal']);
    assert.deepEqual(detectAskedSlots('Great! Which topics excite you more?'), ['interests']);
  });
});
