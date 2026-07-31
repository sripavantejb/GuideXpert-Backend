'use strict';

/**
 * Flow V3 turn dispatcher — architecture §3 processFlowV3Turn.
 */

const crypto = require('crypto');
const { runGateChain } = require('./gates/gateChain');
const { evaluateDemographicGate } = require('./gates/demographicGate');
const { extractFlowV2Slots } = require('../flowV2/flowV2SlotExtractor');
const { mergeFlowV3Profile } = require('./profile/flowV3ProfileMerge');
const { buildTurnContext } = require('./context/buildTurnContext');
const { runLlmLoop, buildTurnMessages } = require('./llm/llmLoop');
const { validateEnvelope } = require('./validate/validateEnvelope');
const { runFallbackLadder } = require('./validate/fallbackLadder');
const { renderEnvelope } = require('./render/renderEnvelope');
const { flushTurnLog } = require('./log/flushTurnLog');
const { createToolBroker } = require('./tools/toolBroker');
const { latestVersion } = require('./llm/promptLoader');

function newTurnId() {
  return typeof crypto.randomUUID === 'function'
    ? `v3_${crypto.randomUUID()}`
    : `v3_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function terminalFromGate(terminal, gateResult) {
  if (!terminal) return null;
  if (terminal.kind === 'opt_out' || gateResult.verdicts?.some((v) => v.verdict === 'silent')) {
    return {
      replyText: null,
      replyParts: null,
      interactive: null,
      nextState: 'career_counselling_flow_v3',
      intent: 'career_counselling_flow_v3',
      silent: true,
      gateResult,
    };
  }
  const copy =
    terminal.copy ||
    terminal.replyText ||
    (terminal.kind === 'crisis' || terminal.route === 'human_handoff'
      ? "I'm really glad you reached out. Please contact Tele-MANAS at 14416 — a human counsellor can help right away."
      : "I can't help with that here — happy to stick to college and career questions.");
  return {
    replyText: copy,
    replyParts: [copy],
    interactive: null,
    nextState: terminal.route === 'human_handoff' ? 'human_handoff' : 'career_counselling_flow_v3',
    intent: 'career_counselling_flow_v3',
    gateResult,
    terminal,
  };
}

/**
 * @param {{
 *   text: string,
 *   phone?: string,
 *   conversationId?: string,
 *   inboundId?: string,
 *   profile?: object,
 *   slotMeta?: object,
 *   promptVersion?: string|null,
 *   mode?: 'shadow'|'live',
 *   history?: Array,
 *   provider?: object,
 *   deps?: object,
 * }} input
 */
async function processFlowV3Turn(input = {}) {
  const turnId = newTurnId();
  const startedAt = Date.now();
  const profile = input.profile || {};
  const mode = input.mode === 'live' ? 'live' : 'shadow';
  const promptVersion = input.promptVersion || latestVersion() || 'v1';

  const gateResult = runGateChain({
    text: input.text,
    profile,
    budget: input.budget,
  });
  if (!gateResult.passed) {
    const terminalReply = terminalFromGate(gateResult.terminal, gateResult);
    await flushTurnLog({
      turnId,
      conversationId: input.conversationId,
      phone: input.phone,
      inboundId: input.inboundId,
      promptVersion,
      inboundText: input.text,
      gateVerdicts: gateResult.verdicts,
      profileBefore: profile,
      blocked: true,
      mode,
      latencyMs: Date.now() - startedAt,
      deliveryStatus: 'gate_terminated',
    }, input.deps || {});
    return { ...terminalReply, turnId, mode, shadowOnly: mode === 'shadow' };
  }

  // §3 step 6 — deterministic slot extraction pre-pass (F-7). Sparse patch
  // merged in-memory so gating and the LLM context see THIS turn's slots.
  // Persistence is the live caller's job (CAS store, channel 'extractor').
  let extractedPatch = {};
  let mergedProfile = profile;
  try {
    extractedPatch = extractFlowV2Slots(input.text, profile) || {};
    if (Object.keys(extractedPatch).length) {
      mergedProfile = mergeFlowV3Profile(profile, extractedPatch).profile;
    }
  } catch (err) {
    console.error('[flowV3] slot extraction pre-pass failed', {
      turnId,
      error: err && err.message ? err.message : String(err),
    });
    extractedPatch = {};
    mergedProfile = profile;
  }

  // §3 step 7 — S-1 re-check AFTER the merge (F-1). The condition can become
  // true mid-conversation as category and gender arrive on different turns.
  // Blocked → verbatim refusal, human route, ZERO LLM and predictor calls.
  const postMergeDemo = evaluateDemographicGate(mergedProfile);
  if (postMergeDemo.blocked) {
    const demoVerdict = {
      gate: 'G-DEMOGRAPHIC-POST-MERGE',
      verdict: 'terminate',
      terminatedTurn: true,
      reason: 'ap_oc_male_blocked_post_merge',
    };
    const gateVerdicts = [...gateResult.verdicts, demoVerdict];
    await flushTurnLog({
      turnId,
      conversationId: input.conversationId,
      phone: input.phone,
      inboundId: input.inboundId,
      promptVersion,
      inboundText: input.text,
      gateVerdicts,
      profileBefore: profile,
      slotPatch: extractedPatch,
      profileAfter: mergedProfile,
      blocked: true,
      mode,
      latencyMs: Date.now() - startedAt,
      deliveryStatus: 'gate_terminated',
    }, input.deps || {});
    return {
      turnId,
      mode,
      shadowOnly: mode === 'shadow',
      replyText: postMergeDemo.copy,
      replyParts: [postMergeDemo.copy],
      interactive: postMergeDemo.buttons
        ? { type: 'button', body: postMergeDemo.copy, buttons: [...postMergeDemo.buttons] }
        : null,
      nextState: 'career_counselling_flow_v3',
      intent: 'career_counselling_flow_v3',
      extractedPatch,
      gateResult: { ...gateResult, passed: false, verdicts: gateVerdicts },
      terminal: {
        kind: 'demographic_blocked',
        route: 'human_agent',
        copy: postMergeDemo.copy,
        buttons: postMergeDemo.buttons,
      },
    };
  }

  let turnContext = null;
  try {
    turnContext = buildTurnContext({
      profile: mergedProfile,
      slotMeta: input.slotMeta || {},
      turns: input.history || input.turns || [],
      text: input.text,
      promptVersion,
      purpose: input.purpose || null,
    });
  } catch (err) {
    // F-9: the turn proceeds on a degraded context, but the failure is logged.
    console.error('[flowV3] TURN_CONTEXT_BUILD_FAILED', {
      turnId,
      error: err && err.message ? err.message : String(err),
    });
    turnContext = { error: err.message };
  }

  const broker = createToolBroker({ deps: input.deps || {} });
  let loopResult;
  try {
    const { messages, prompt } = buildTurnMessages({
      promptVersion,
      userText: input.text,
      turnContext,
    });
    loopResult = await runLlmLoop({
      messages,
      promptVersion,
      toolContext: {
        phone: input.phone,
        conversationId: input.conversationId,
        turnId,
        profile: mergedProfile,
        slotMeta: input.slotMeta || {},
      },
      broker,
      provider: input.provider,
      deps: input.deps,
    });
    loopResult.prompt = prompt;
  } catch (err) {
    loopResult = { ok: false, reason: err.message || 'llm_error', toolTrace: [], envelope: null };
  }

  let envelope = loopResult.envelope;
  let validation = null;
  let regenerated = false;
  let fallback = null;

  if (loopResult.ok && envelope) {
    validation = validateEnvelope(envelope, {
      toolTrace: loopResult.toolTrace || [],
      nextSlotHint: turnContext?.nextSlot || null,
      inboundText: input.text,
      profile: mergedProfile,
    });
    if (!validation.ok) {
      // One regeneration with violation feedback
      regenerated = true;
      try {
        const { messages } = buildTurnMessages({
          promptVersion,
          userText: input.text,
          turnContext,
        });
        const retry = await runLlmLoop({
          messages,
          toolContext: {
            phone: input.phone,
            conversationId: input.conversationId,
            turnId,
            profile: mergedProfile,
          },
          broker,
          provider: input.provider,
          repairFeedback: validation.violations.map((v) => `${v.code}:${v.detail}`).join('; '),
        });
        if (retry.ok && retry.envelope) {
          const v2 = validateEnvelope(retry.envelope, {
            toolTrace: retry.toolTrace || [],
            inboundText: input.text,
            profile: mergedProfile,
          });
          if (v2.ok) {
            envelope = v2.envelope;
            validation = v2;
            loopResult = retry;
          } else {
            validation = v2;
            fallback = runFallbackLadder({ profile: mergedProfile, slotMeta: input.slotMeta, reason: 'validation_block' });
          }
        } else {
          fallback = runFallbackLadder({ profile: mergedProfile, slotMeta: input.slotMeta, reason: loopResult.reason || 'parse_failed' });
        }
      } catch {
        fallback = runFallbackLadder({ profile: mergedProfile, slotMeta: input.slotMeta, reason: 'regen_failed' });
      }
    } else {
      envelope = validation.envelope;
    }
  } else {
    fallback = runFallbackLadder({ profile: mergedProfile, slotMeta: input.slotMeta, reason: loopResult.reason || 'llm_failed' });
  }

  let rendered;
  if (fallback) {
    rendered = {
      replyText: fallback.replyText,
      replyParts: fallback.replyParts,
      interactive: null,
      replyMedia: null,
    };
  } else {
    rendered = renderEnvelope(envelope, { toolTrace: loopResult.toolTrace || [] });
  }

  // F-6 — envelope.profile_patch was parsed, validated and then DROPPED.
  // Filter it through the LLM write policy in-memory (allowlist, capture
  // meta) so profileAfter is honest in every mode; the live caller persists
  // the accepted keys through the CAS store. LLM restatements are captured
  // as source 'inferred' — NON-authoritative by contract, so an LLM claim
  // can never satisfy a routing/predictor gate the way a student's actual
  // answer (button/typed/extracted) does.
  let llmPatch = null;
  let profileFinal = mergedProfile;
  const rawLlmPatch = !fallback && validation?.ok && envelope ? envelope.profile_patch : null;
  if (rawLlmPatch && typeof rawLlmPatch === 'object' && Object.keys(rawLlmPatch).length) {
    try {
      const { validateProfilePatch } = require('./profile/flowV3ProfileWritePolicy');
      const meta = {};
      for (const key of Object.keys(rawLlmPatch)) {
        meta[key] = {
          source: 'inferred',
          confidence: 0.6,
          verbatimQuote: String(input.text || ''),
        };
      }
      const verdict = validateProfilePatch({
        patch: rawLlmPatch,
        meta,
        channel: 'llm_tool',
        turnId,
      });
      llmPatch = {
        accepted: verdict.accepted || {},
        acceptedMeta: verdict.acceptedMeta || {},
        rejected: verdict.rejected || [],
        dropped: verdict.dropped || [],
      };
      if (llmPatch.rejected.length || llmPatch.dropped.length) {
        console.warn('[flowV3] LLM_PROFILE_PATCH_FILTERED', {
          turnId,
          rejected: llmPatch.rejected.map((r) => `${r.field}:${r.code}`),
          dropped: llmPatch.dropped.map((d) => d.field),
        });
      }
      if (Object.keys(llmPatch.accepted).length) {
        profileFinal = mergeFlowV3Profile(mergedProfile, llmPatch.accepted).profile;
      }
    } catch (err) {
      console.error('[flowV3] LLM_PROFILE_PATCH_FAILED', {
        turnId,
        error: err && err.message ? err.message : String(err),
      });
      llmPatch = null;
      profileFinal = mergedProfile;
    }
  }

  const latencyMs = Date.now() - startedAt;
  await flushTurnLog({
    turnId,
    conversationId: input.conversationId,
    phone: input.phone,
    inboundId: input.inboundId,
    promptVersion,
    promptHash: loopResult.prompt?.hash || null,
    inboundText: input.text,
    gateVerdicts: gateResult.verdicts,
    profileBefore: profile,
    slotPatch: { ...extractedPatch, ...(llmPatch ? llmPatch.accepted : {}) },
    profileAfter: profileFinal,
    toolTrace: loopResult.toolTrace || [],
    envelope: envelope || null,
    validationVerdicts: (validation?.violations || []).map((v) => ({
      check: v.code,
      verdict: validation?.ok ? 'pass' : 'block',
      detail: v.detail,
    })),
    blocked: Boolean(fallback),
    regenerated,
    fallbackTier: fallback?.tier || null,
    mode,
    latencyMs,
    deliveryStatus: mode === 'shadow' ? 'shadow_only' : 'ready',
  }, input.deps || {});

  return {
    turnId,
    mode,
    shadowOnly: mode === 'shadow',
    replyText: rendered.replyText,
    replyParts: rendered.replyParts,
    interactive: rendered.interactive,
    replyMedia: rendered.replyMedia,
    nextState: 'career_counselling_flow_v3',
    intent: 'career_counselling_flow_v3',
    contextPatch: {
      flowV3: {
        promptVersion,
        engine: 'flow_v3',
        mode,
        lastTurnId: turnId,
      },
    },
    envelope,
    validation,
    fallback,
    gateResult,
    extractedPatch,
    llmPatch,
    toolTrace: loopResult.toolTrace || [],
    latencyMs,
    localizationTier: 'static',
    preLocalized: true,
  };
}

module.exports = {
  processFlowV3Turn,
  newTurnId,
};
