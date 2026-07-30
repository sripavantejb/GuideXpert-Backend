'use strict';

/**
 * Flow V3 turn dispatcher — architecture §3 processFlowV3Turn.
 */

const crypto = require('crypto');
const { runGateChain } = require('./gates/gateChain');
const { buildTurnContext } = require('./context/buildTurnContext');
const { runLlmLoop, buildTurnMessages } = require('./llm/llmLoop');
const { validateEnvelope } = require('./validate/validateEnvelope');
const { runFallbackLadder } = require('./validate/fallbackLadder');
const { renderEnvelope } = require('./render/renderEnvelope');
const { writeTurnLog } = require('./log/turnLog');
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
    writeTurnLog({
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
    }).catch(() => {});
    return { ...terminalReply, turnId, mode, shadowOnly: mode === 'shadow' };
  }

  let turnContext = null;
  try {
    turnContext = buildTurnContext({
      profile,
      slotMeta: input.slotMeta || {},
      turns: input.history || input.turns || [],
      text: input.text,
      promptVersion,
      purpose: input.purpose || null,
    });
  } catch (err) {
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
        profile,
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
            profile,
          },
          broker,
          provider: input.provider,
          repairFeedback: validation.violations.map((v) => `${v.code}:${v.detail}`).join('; '),
        });
        if (retry.ok && retry.envelope) {
          const v2 = validateEnvelope(retry.envelope, { toolTrace: retry.toolTrace || [] });
          if (v2.ok) {
            envelope = v2.envelope;
            validation = v2;
            loopResult = retry;
          } else {
            validation = v2;
            fallback = runFallbackLadder({ profile, slotMeta: input.slotMeta, reason: 'validation_block' });
          }
        } else {
          fallback = runFallbackLadder({ profile, slotMeta: input.slotMeta, reason: loopResult.reason || 'parse_failed' });
        }
      } catch {
        fallback = runFallbackLadder({ profile, slotMeta: input.slotMeta, reason: 'regen_failed' });
      }
    } else {
      envelope = validation.envelope;
    }
  } else {
    fallback = runFallbackLadder({ profile, slotMeta: input.slotMeta, reason: loopResult.reason || 'llm_failed' });
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

  const latencyMs = Date.now() - startedAt;
  writeTurnLog({
    turnId,
    conversationId: input.conversationId,
    phone: input.phone,
    inboundId: input.inboundId,
    promptVersion,
    promptHash: loopResult.prompt?.hash || null,
    inboundText: input.text,
    gateVerdicts: gateResult.verdicts,
    profileBefore: profile,
    profileAfter: profile,
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
  }).catch(() => {});

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
