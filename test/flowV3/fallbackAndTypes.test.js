'use strict';

/**
 * F-4 + F-5 regression.
 *
 * F-4: Tier A must re-ask the current slot with the VERBATIM Flow V2 beat
 * copy. The previous `slot.askable || <template>` emitted the string "true"
 * (askable is a boolean) or an invented template — students saw copy no
 * product owner ever wrote.
 *
 * F-5: student-facing strings must BE strings. A boolean body must be
 * blocked at validation and dropped by the renderer, never coerced.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { runFallbackLadder } = require('../../services/chatbot/flowV3LLM/validate/fallbackLadder');
const {
  FALLBACK_BEAT_COPY,
  beatCopyForSlot,
} = require('../../services/chatbot/flowV3LLM/validate/fallbackBeatCopy');
const { validateEnvelope } = require('../../services/chatbot/flowV3LLM/validate/validateEnvelope');
const { renderEnvelope } = require('../../services/chatbot/flowV3LLM/render/renderEnvelope');

const { NEUTRAL_QUALIFICATION_LINE } = require('../../services/chatbot/flowV2/nodes/greeting');
const { B2_BODY } = require('../../services/chatbot/flowV2/nodes/b2Goal');
const {
  BUDGET_QUESTION,
  LOCATION_QUESTION_ONLY,
} = require('../../services/chatbot/flowV2/nodes/b3Constraints');

describe('F-4: Tier A uses verbatim V2 beat copy', () => {
  test('empty profile asks the V2 qualification question verbatim — never "true"', () => {
    const out = runFallbackLadder({ profile: {}, reason: 'llm_failed' });
    assert.equal(out.tier, 'A');
    assert.equal(out.slot, 'qualification');
    assert.equal(out.replyText, NEUTRAL_QUALIFICATION_LINE);
    assert.notEqual(out.replyText, 'true');
  });

  test('mid-journey profile asks the V2 copy for the NEXT slot', () => {
    const out = runFallbackLadder({
      profile: { qualification: '12th Completed (PCM)', goalPriority: ['placements'] },
      reason: 'validation_block',
    });
    assert.equal(out.tier, 'A');
    assert.ok(
      Object.values(FALLBACK_BEAT_COPY).includes(out.replyText),
      `reply must be one of the V2 beat questions, got: ${out.replyText}`
    );
  });

  test('every mapped copy string is the live V2 export (verbatim by construction)', () => {
    assert.equal(FALLBACK_BEAT_COPY.qualification, NEUTRAL_QUALIFICATION_LINE);
    assert.equal(FALLBACK_BEAT_COPY.goal, B2_BODY);
    assert.equal(FALLBACK_BEAT_COPY.budgetBand, BUDGET_QUESTION);
    assert.equal(FALLBACK_BEAT_COPY.cityPref, LOCATION_QUESTION_ONLY);
    for (const copy of Object.values(FALLBACK_BEAT_COPY)) {
      assert.equal(typeof copy, 'string');
      assert.ok(copy.length > 10);
    }
  });

  test('every askable slot in the V3 walk has V2 copy — Tier A is fully covered', () => {
    const {
      LEAD_PROFILE_SCHEMA,
      BEAT_ORDER,
      getSlotsForBeat,
    } = require('../../constants/careerCounsellingFlowV2Profile');
    for (const beat of BEAT_ORDER) {
      for (const slotKey of getSlotsForBeat(beat)) {
        if (LEAD_PROFILE_SCHEMA[slotKey].askable !== true) continue;
        assert.ok(
          beatCopyForSlot(slotKey),
          `askable slot ${slotKey} has no V2 beat copy — Tier A would silently degrade`
        );
      }
    }
  });

  test('tier reachability: complete profile → Tier B holding + escalate', () => {
    const fullProfile = {
      qualification: '12th Completed (PCM)',
      goalPriority: ['placements'],
      goal: 'branch_fit',
      interests: ['Coding & software'],
      budgetBand: '2-4L',
      cityPref: 'Open to moving',
    };
    const out = runFallbackLadder({ profile: fullProfile, reason: 'llm_failed' });
    assert.equal(out.tier, 'B');
    assert.equal(out.escalate, true);
  });

  test('tier reachability: free_form reason → Tier B even with open slots', () => {
    const out = runFallbackLadder({ profile: {}, reason: 'free_form' });
    assert.equal(out.tier, 'B');
  });
});

describe('F-5: non-string bodies are rejected, never coerced', () => {
  test('boolean part body is a validation BLOCK', () => {
    const out = validateEnvelope(
      {
        intent: 'ask_slot',
        parts: [{ type: 'text', body: true }],
        grounding: [],
        profile_patch: {},
        booking_url_slot: null,
      },
      { toolTrace: [] }
    );
    assert.equal(out.ok, false);
    assert.ok(
      out.violations.some((v) => String(v.detail).includes('part_body_not_string')),
      `expected part_body_not_string, got ${JSON.stringify(out.violations)}`
    );
  });

  test('object body and non-string option titles are BLOCKED', () => {
    const out = validateEnvelope(
      {
        intent: 'ask_slot',
        parts: [
          { type: 'text', body: { nested: 'object' } },
          { type: 'buttons', body: 'Pick one', options: [{ id: 'a', title: 42 }] },
        ],
        grounding: [],
        profile_patch: {},
        booking_url_slot: null,
      },
      { toolTrace: [] }
    );
    assert.equal(out.ok, false);
    assert.ok(out.violations.some((v) => String(v.detail).includes('part_body_not_string')));
    assert.ok(out.violations.some((v) => String(v.detail).includes('part_option_title_not_string')));
  });

  test('renderer drops a boolean body instead of sending "true"', () => {
    const rendered = renderEnvelope(
      {
        intent: 'ask_slot',
        parts: [{ type: 'text', body: true }],
        grounding: [],
      },
      { toolTrace: [] }
    );
    assert.equal(rendered.replyText, null);
    assert.equal(rendered.replyParts, null);
  });

  test('valid string bodies still render normally', () => {
    const rendered = renderEnvelope(
      {
        intent: 'ask_slot',
        parts: [{ type: 'text', body: 'Which city do you prefer?' }],
        grounding: [],
      },
      { toolTrace: [] }
    );
    assert.equal(rendered.replyText, 'Which city do you prefer?');
  });
});
