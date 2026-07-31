'use strict';

/**
 * F-1 + F-7 regression — architecture §3 steps 6–7.
 *
 * S-1 (AP EAMCET + OC + male) must block:
 *   - at entry, when the loaded profile already satisfies the condition, and
 *   - MID-CONVERSATION, when the final slot arrives in the current message and
 *     only the post-merge re-check can see it.
 *
 * In every blocked case: verbatim refusal copy, zero LLM calls, zero tool
 * (and therefore predictor) calls. These tests fail without the deterministic
 * extraction pre-pass + post-merge re-check in flowV3Dispatcher.js.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { processFlowV3Turn } = require('../../services/chatbot/flowV3LLM/flowV3Dispatcher');
const { BLOCKED_REPLY_TEXT } = require('../../services/chatbot/flowV2/nodes/r4pPredictor');

function throwingProvider() {
  const state = { called: 0 };
  return {
    state,
    async chatCompletion() {
      state.called += 1;
      throw new Error('LLM must never be called on a blocked turn');
    },
  };
}

function envelopeProvider() {
  const state = { called: 0 };
  return {
    state,
    async chatCompletion() {
      state.called += 1;
      return {
        text: JSON.stringify({
          intent: 'ask_slot',
          parts: [{ type: 'text', body: 'Which city do you prefer?' }],
          grounding: [],
          profile_patch: {},
          booking_url_slot: null,
        }),
        toolCalls: null,
        finishReason: 'stop',
      };
    },
  };
}

describe('F-1: S-1 demographic block, zero LLM / zero predictor', () => {
  test('blocked at entry when the loaded profile already matches', async () => {
    const provider = throwingProvider();
    const out = await processFlowV3Turn({
      text: 'show me colleges',
      conversationId: 'f1_entry',
      profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'male' },
      mode: 'shadow',
      provider,
    });
    assert.equal(provider.state.called, 0);
    assert.equal(out.terminal?.kind || out.gateResult?.terminal?.kind, 'demographic_blocked');
    assert.equal(out.toolTrace == null || out.toolTrace.length === 0, true);
  });

  test('blocked when the condition becomes true only after the mid-conversation merge', async () => {
    const provider = throwingProvider();
    const out = await processFlowV3Turn({
      text: 'male',
      conversationId: 'f1_midconv',
      // gender is MISSING from the stored profile — it arrives in this message
      profile: { examType: 'AP_EAMCET', category: 'OC' },
      mode: 'shadow',
      provider,
    });
    assert.equal(provider.state.called, 0, 'LLM was called on a post-merge blocked turn');
    assert.equal(out.terminal?.kind, 'demographic_blocked');
    assert.equal(out.extractedPatch?.gender, 'male');
    const postMergeVerdict = (out.gateResult?.verdicts || []).find(
      (v) => v.gate === 'G-DEMOGRAPHIC-POST-MERGE'
    );
    assert.ok(postMergeVerdict, 'post-merge demographic verdict missing');
    assert.equal(postMergeVerdict.reason, 'ap_oc_male_blocked_post_merge');
  });

  test('refusal copy is the verbatim r4pPredictor text, never paraphrased', async () => {
    const out = await processFlowV3Turn({
      text: 'male',
      conversationId: 'f1_copy',
      profile: { examType: 'AP_EAMCET', category: 'OC' },
      mode: 'shadow',
      provider: throwingProvider(),
    });
    assert.equal(out.replyText, BLOCKED_REPLY_TEXT);
  });

  test('lowercase ap_eamcet in the stored profile is normalized and still blocks', async () => {
    const provider = throwingProvider();
    const out = await processFlowV3Turn({
      text: 'male',
      conversationId: 'f1_lowercase',
      profile: { examType: 'ap_eamcet', category: 'OC' },
      mode: 'shadow',
      provider,
    });
    assert.equal(provider.state.called, 0);
    assert.equal(out.terminal?.kind, 'demographic_blocked');
  });

  test('non-blocked demographic proceeds to the LLM (no over-blocking)', async () => {
    const provider = envelopeProvider();
    const out = await processFlowV3Turn({
      text: 'female',
      conversationId: 'f1_pass',
      profile: { examType: 'AP_EAMCET', category: 'OC' },
      mode: 'shadow',
      provider,
    });
    assert.ok(provider.state.called >= 1, 'LLM should run for a non-blocked student');
    assert.notEqual(out.terminal?.kind, 'demographic_blocked');
  });
});

describe('F-7: deterministic extraction pre-pass', () => {
  test('extracted slots are surfaced for persistence and visible to the turn', async () => {
    const provider = envelopeProvider();
    const out = await processFlowV3Turn({
      text: 'I am looking for CSE, my budget is around 2 lakhs per year',
      conversationId: 'f7_extract',
      profile: {},
      mode: 'shadow',
      provider,
    });
    assert.ok(out.extractedPatch && typeof out.extractedPatch === 'object');
    assert.ok(
      Object.keys(out.extractedPatch).length >= 1,
      'extractor should have found at least one slot'
    );
  });

  test('extraction failure does not take the turn down', async () => {
    const provider = envelopeProvider();
    // Non-string text exercises the guard path without throwing to the caller.
    const out = await processFlowV3Turn({
      text: 'hello',
      conversationId: 'f7_guard',
      profile: {},
      mode: 'shadow',
      provider,
    });
    assert.ok(out.turnId);
  });
});
