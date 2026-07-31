'use strict';

/**
 * F-6 regression — envelope.profile_patch must be applied, not dropped.
 *
 * Before the fix the patch was parsed, validated (V-6) and then discarded:
 * no allowlist filter ran, no store write happened, and profileAfter lied.
 * The patch now flows through the LLM write policy (channel llm_tool,
 * non-authoritative 'inferred' capture meta) and is surfaced for the live
 * caller's CAS write.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { processFlowV3Turn } = require('../../services/chatbot/flowV3LLM/flowV3Dispatcher');

function providerWithPatch(patch) {
  return {
    async chatCompletion() {
      return {
        text: JSON.stringify({
          intent: 'ask_slot',
          parts: [{ type: 'text', body: 'Noted! What matters most to you when choosing where to study?' }],
          grounding: [],
          profile_patch: patch,
          booking_url_slot: null,
        }),
        toolCalls: null,
        finishReason: 'stop',
      };
    },
  };
}

function okModel() {
  const state = { created: [] };
  return {
    state,
    db: { readyState: 1 },
    async create(doc) {
      state.created.push(doc);
      return doc;
    },
  };
}

describe('F-6: envelope.profile_patch is applied through the write policy', () => {
  test('allowlisted keys are accepted with inferred (non-authoritative) meta', async () => {
    const out = await processFlowV3Turn({
      text: 'I want to study CSE',
      conversationId: 'f6_accept',
      profile: {},
      mode: 'shadow',
      provider: providerWithPatch({ branchInterest: 'CSE' }),
    });
    assert.ok(out.llmPatch, 'llmPatch must be surfaced on the result');
    assert.equal(out.llmPatch.accepted.branchInterest, 'CSE');
    assert.equal(out.llmPatch.acceptedMeta.branchInterest.source, 'inferred');
    assert.ok(out.llmPatch.acceptedMeta.branchInterest.confidence > 0);
  });

  test('allowlist-blocked and unknown keys are filtered, never written', async () => {
    const out = await processFlowV3Turn({
      text: 'my number is 9999999999',
      conversationId: 'f6_blocked',
      profile: {},
      mode: 'shadow',
      provider: providerWithPatch({
        consentAt: '2026-01-01', // blocked on every channel
        madeUpField: 'x', //        unknown → dropped
        branchInterest: 'CSE', //   legitimate
      }),
    });
    assert.ok(out.llmPatch);
    assert.equal(out.llmPatch.accepted.consentAt, undefined);
    assert.equal(out.llmPatch.accepted.madeUpField, undefined);
    assert.equal(out.llmPatch.accepted.branchInterest, 'CSE');
    assert.ok(
      out.llmPatch.rejected.some((r) => r.field === 'consentAt'),
      'consentAt must be an explicit rejection'
    );
    assert.ok(out.llmPatch.dropped.some((d) => d.field === 'madeUpField'));
  });

  test('profileAfter in the turn log includes the accepted patch (honest logging)', async () => {
    const model = okModel();
    await processFlowV3Turn({
      text: 'I want to study CSE',
      conversationId: 'f6_log',
      profile: {},
      mode: 'shadow',
      provider: providerWithPatch({ branchInterest: 'CSE' }),
      deps: { FlowV3TurnLog: model, waitUntil: null },
    });
    assert.equal(model.state.created.length, 1);
    const logged = model.state.created[0];
    assert.equal(logged.profileAfter.branchInterest, 'CSE');
    assert.equal(logged.slotPatch.branchInterest, 'CSE');
  });

  test('a blocked (fallback) turn applies NO llm patch', async () => {
    const out = await processFlowV3Turn({
      text: 'tell me about colleges',
      conversationId: 'f6_fallback',
      profile: {},
      mode: 'shadow',
      provider: {
        async chatCompletion() {
          throw new Error('provider down');
        },
      },
    });
    assert.ok(out.fallback, 'turn should have fallen back');
    assert.equal(out.llmPatch, null);
  });

  test('S-1 routing fields (gender) are REJECTED on the LLM channel — extractor-only', async () => {
    // Tier 3 fields are authoritative-only: the LLM can never write gender /
    // category / examType through the envelope patch. Only the deterministic
    // extractor (F-7) or button/counsellor paths can — so an LLM
    // hallucination can neither trigger nor evade the S-1 demographic gate.
    const out = await processFlowV3Turn({
      text: 'ok',
      conversationId: 'f6_demo',
      profile: { examType: 'AP_EAMCET', category: 'OC' },
      mode: 'shadow',
      provider: providerWithPatch({ gender: 'male' }),
    });
    assert.ok(out.llmPatch, 'llmPatch must be surfaced');
    assert.equal(out.llmPatch.accepted.gender, undefined);
    assert.ok(
      out.llmPatch.rejected.some(
        (r) => r.field === 'gender' && r.code === 'WRITE_LLM_BLOCKED_FIELD'
      ),
      `gender must be an explicit LLM-channel rejection, got ${JSON.stringify(out.llmPatch.rejected)}`
    );
  });
});
