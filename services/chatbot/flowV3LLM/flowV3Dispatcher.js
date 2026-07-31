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
const { latestVersion, refreshPromptOverrideFromDb } = require('./llm/promptLoader');

function newTurnId() {
  return typeof crypto.randomUUID === 'function'
    ? `v3_${crypto.randomUUID()}`
    : `v3_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Recompute the expected-slot hint AFTER the model's update_lead_profile
 * writes this turn. Only reloads the store when a write actually succeeded,
 * so canned-provider tests (no tool calls) never touch Mongo.
 */
async function resolvePostWriteSlotHint({ baseHint, toolTrace, phone, slotMeta, deps }) {
  const wrote = (toolTrace || []).some(
    (t) => t && t.name === 'update_lead_profile' && t.ok && t.result && t.result.ok === true
  );
  if (!wrote || !phone) return baseHint;
  try {
    const load = (deps && deps.loadLeadProfile) || require('./profile').loadLeadProfile;
    const fresh = await load(phone);
    if (!fresh) return baseHint;
    const { nextFlowV3Slot } = require('./profile/flowV3NextSlot');
    return nextFlowV3Slot(fresh.profile || {}, { slotMeta: fresh.slotMeta || slotMeta || {} });
  } catch (err) {
    console.warn('[flowV3] POST_WRITE_SLOT_HINT_FAILED', {
      error: err && err.message ? err.message : String(err),
    });
    return baseHint;
  }
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

  // Pull latest admin-edited prompt from Mongo (TTL-cached) before building messages.
  try {
    await refreshPromptOverrideFromDb();
  } catch (_) {
    // File / existing override remain the fallback.
  }

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

    // Asked-slot capture, reusing the FROZEN V2 node parsers verbatim: when
    // the beat walk is waiting on goal (B2) or interests (B3), the student's
    // reply — free text or a V2 button/list postback id — is the answer to
    // that slot. The generic extractor never covered these, the LLM saved
    // them only unreliably, and the walk looped on the same question forever
    // (conformance finding G-2). Deterministic code capturing the student's
    // own answer is the V2 node behaviour, not new product logic.
    try {
      const { nextFlowV3Slot } = require('./profile/flowV3NextSlot');
      const askedSlot = nextFlowV3Slot(profile, { slotMeta: input.slotMeta || {} });
      if (askedSlot && askedSlot.slot === 'goal' && extractedPatch.goal == null) {
        const { extractGoal } = require('../flowV2/nodes/b2Goal');
        const goal = extractGoal(input.text);
        if (goal) extractedPatch.goal = goal;
      } else if (
        askedSlot &&
        askedSlot.slot === 'interests' &&
        extractedPatch.interests == null
      ) {
        const { matchInterest } = require('../flowV2/nodes/b2Branch');
        const def = matchInterest(input.text);
        if (def) extractedPatch.interests = [def.label];
      }
    } catch (err) {
      console.warn('[flowV3] asked-slot capture failed', {
        turnId,
        error: err && err.message ? err.message : String(err),
      });
    }

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
        casVersion: input.casVersion ?? null,
        inboundText: input.text,
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

  // V-8 must judge beat discipline against the walk AFTER this turn's tool
  // writes: when the model persisted the asked slot via update_lead_profile
  // and then asked the NEXT beat, the stale pre-turn hint called that correct
  // reply a wrong-slot ask and threw the whole LLM turn away (observed:
  // "I enjoy coding and robotics" → interests saved by the model →
  // goalPriority asked → Tier A fallback).
  const nextSlotHint = await resolvePostWriteSlotHint({
    baseHint: turnContext?.nextSlot || null,
    toolTrace: loopResult.toolTrace || [],
    phone: input.phone,
    slotMeta: input.slotMeta || {},
    deps: input.deps,
  });

  if (loopResult.ok && envelope) {
    validation = validateEnvelope(envelope, {
      toolTrace: loopResult.toolTrace || [],
      nextSlotHint,
      inboundText: input.text,
      profile: mergedProfile,
    });
    if (!validation.ok) {
      // One regeneration with violation feedback
      regenerated = true;
      try {
        const { messages, prompt: retryPrompt } = buildTurnMessages({
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
            slotMeta: input.slotMeta || {},
            casVersion: input.casVersion ?? null,
            inboundText: input.text,
          },
          broker,
          provider: input.provider,
          // Actionable feedback: the bare code string ("V-8:beat_discipline…")
          // was routinely ignored and the retry repeated the same violation.
          repairFeedback: [
            validation.violations.map((v) => `${v.code}:${v.detail}`).join('; '),
            validation.violations.some((v) => String(v.detail || '').startsWith('beat_discipline')) &&
            nextSlotHint?.slot
              ? `You MUST ask about the "${nextSlotHint.slot}" slot and nothing else.`
              : '',
            validation.violations.some((v) => String(v.detail || '').includes('grounding'))
              ? 'Remove every college name and number that does not come from a tool result cited in "grounding". If you used no data tools, "grounding" must be [].'
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        });
        if (retry.ok && retry.envelope) {
          // The retry validates with the nextSlot hint as well: omitting it
          // opened the V-8 hole where a repeated wrong-slot ask passed on
          // attempt 2 (conformance finding 4). Recomputed because the retry
          // may have written more slots through update_lead_profile.
          const retryHint = await resolvePostWriteSlotHint({
            baseHint: nextSlotHint,
            toolTrace: retry.toolTrace || [],
            phone: input.phone,
            slotMeta: input.slotMeta || {},
            deps: input.deps,
          });
          const v2 = validateEnvelope(retry.envelope, {
            toolTrace: retry.toolTrace || [],
            nextSlotHint: retryHint,
            inboundText: input.text,
            profile: mergedProfile,
          });
          if (v2.ok) {
            envelope = v2.envelope;
            validation = v2;
            // Keep the prompt identity: replacing loopResult dropped it, so
            // regenerated turns logged promptHash null and failed the audit.
            retry.prompt = retry.prompt || retryPrompt;
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
