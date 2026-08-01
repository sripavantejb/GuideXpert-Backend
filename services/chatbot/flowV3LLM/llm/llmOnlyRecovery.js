'use strict';

/**
 * LLM-only recovery — replaces the mechanical fallback ladder for live turns.
 *
 * Safe mode: one (optionally two) LLM calls under the admin prompt + SAFE_MODE
 * addendum. Crisis mode: LLM must include Tele-MANAS 14416; backstop only if
 * the model fails after retry. OpenAI total failure → OUTAGE_APOLOGY.
 */

const { buildTurnMessages, runLlmLoop } = require('./llmLoop');
const { validateEnvelope } = require('../validate/validateEnvelope');
const { renderEnvelope } = require('../render/renderEnvelope');
const {
  OUTAGE_APOLOGY,
  CRISIS_BACKSTOP,
  SAFE_MODE_ADDENDUM,
  CRISIS_MODE_ADDENDUM,
} = require('./modeAddenda');

function envelopeBodies(envelope) {
  return (envelope?.parts || [])
    .filter((p) => p && p.type === 'text')
    .map((p) => String(p.body || ''))
    .join('\n');
}

function hasBannedGuarantee(envelope) {
  const text = envelopeBodies(envelope);
  // Allow the mandated shortlist disclosure line.
  const stripped = text.replace(/not a guaranteed admission list/gi, '');
  return /\bguaranteed?\b/i.test(stripped);
}

function crisisHasHelpline(envelope) {
  const text = envelopeBodies(envelope);
  return /Tele-MANAS/i.test(text) && /14416/.test(text);
}

/**
 * Light validation for recovery turns: parse + structure + no banned
 * guarantee language. Full grounding/beat checks still apply when toolTrace
 * is present (via validateEnvelope); when tools are empty, grounding must
 * also be empty / no college inventions.
 */
function lightValidate(envelope, opts = {}) {
  if (!envelope) return { ok: false, reason: 'no_envelope' };
  if (hasBannedGuarantee(envelope)) {
    return { ok: false, reason: 'banned_guarantee' };
  }
  const full = validateEnvelope(envelope, {
    toolTrace: opts.toolTrace || [],
    nextSlotHint: opts.nextSlotHint || null,
    inboundText: opts.inboundText || '',
    profile: opts.profile || {},
  });
  if (!full.ok) {
    // Soften beat_discipline on recovery — answering the student matters more
    // than the exact next slot when we already failed once.
    const hard = (full.violations || []).filter(
      (v) => !String(v.detail || '').startsWith('beat_discipline') && v.code !== 'V-8'
    );
    if (hard.length) {
      return {
        ok: false,
        reason: hard.map((v) => `${v.code}:${v.detail}`).join('; '),
        violations: hard,
      };
    }
  }
  return { ok: true, envelope: full.envelope || envelope };
}

async function runRecoveryLoop({
  mode, // 'safe' | 'crisis'
  promptVersion,
  userText,
  turnContext,
  toolContext,
  broker,
  provider,
  deps,
  nextSlotHint,
  profile,
  repairHint = '',
}) {
  const systemExtra = mode === 'crisis' ? CRISIS_MODE_ADDENDUM : SAFE_MODE_ADDENDUM;
  const { messages, prompt } = buildTurnMessages({
    promptVersion,
    systemExtra,
    userText,
    turnContext,
  });

  let loopResult;
  try {
    loopResult = await runLlmLoop({
      messages,
      promptVersion,
      toolContext,
      broker,
      provider,
      deps,
      repairFeedback: repairHint || undefined,
    });
  } catch (err) {
    return { ok: false, reason: err.message || 'llm_error', prompt };
  }
  loopResult.prompt = loopResult.prompt || prompt;

  if (!loopResult.ok || !loopResult.envelope) {
    return {
      ok: false,
      reason: loopResult.reason || 'parse_failed',
      prompt: loopResult.prompt,
      toolTrace: loopResult.toolTrace || [],
    };
  }

  if (mode === 'crisis') {
    if (!crisisHasHelpline(loopResult.envelope)) {
      return {
        ok: false,
        reason: 'crisis_missing_helpline',
        prompt: loopResult.prompt,
        toolTrace: loopResult.toolTrace || [],
        envelope: loopResult.envelope,
      };
    }
    // Minimal structural check — crisis envelopes skip college grounding.
    const parsedOk =
      loopResult.envelope.intent === 'escalate' &&
      Array.isArray(loopResult.envelope.parts) &&
      loopResult.envelope.parts.some((p) => p?.type === 'text' && p.body);
    if (!parsedOk) {
      return {
        ok: false,
        reason: 'crisis_envelope_invalid',
        prompt: loopResult.prompt,
        toolTrace: loopResult.toolTrace || [],
      };
    }
    return {
      ok: true,
      envelope: loopResult.envelope,
      prompt: loopResult.prompt,
      toolTrace: loopResult.toolTrace || [],
      loopResult,
    };
  }

  const validated = lightValidate(loopResult.envelope, {
    toolTrace: loopResult.toolTrace || [],
    nextSlotHint,
    inboundText: userText,
    profile,
  });
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason || 'validation_block',
      prompt: loopResult.prompt,
      toolTrace: loopResult.toolTrace || [],
      envelope: loopResult.envelope,
    };
  }
  return {
    ok: true,
    envelope: validated.envelope,
    prompt: loopResult.prompt,
    toolTrace: loopResult.toolTrace || [],
    loopResult,
  };
}

/**
 * Safe-mode recovery with one automatic retry. Returns rendered reply fields
 * or the outage apology when OpenAI cannot produce a valid envelope.
 */
async function recoverWithSafeMode(input = {}) {
  const first = await runRecoveryLoop({ ...input, mode: 'safe' });
  if (first.ok) {
    const rendered = renderEnvelope(first.envelope, { toolTrace: first.toolTrace });
    return {
      ok: true,
      source: 'safe_mode_llm',
      envelope: first.envelope,
      prompt: first.prompt,
      toolTrace: first.toolTrace,
      rendered,
      loopResult: first.loopResult,
    };
  }

  const second = await runRecoveryLoop({
    ...input,
    mode: 'safe',
    repairHint: `Previous safe-mode attempt failed (${first.reason}). Fix it. Never use the word guarantee. No ungrounded college names.`,
  });
  if (second.ok) {
    const rendered = renderEnvelope(second.envelope, { toolTrace: second.toolTrace });
    return {
      ok: true,
      source: 'safe_mode_llm_retry',
      envelope: second.envelope,
      prompt: second.prompt,
      toolTrace: second.toolTrace,
      rendered,
      loopResult: second.loopResult,
    };
  }

  return {
    ok: false,
    source: 'outage_apology',
    reason: second.reason || first.reason || 'llm_failed',
    prompt: second.prompt || first.prompt || null,
    toolTrace: second.toolTrace || first.toolTrace || [],
    rendered: {
      replyText: OUTAGE_APOLOGY,
      replyParts: [OUTAGE_APOLOGY],
      interactive: null,
      replyMedia: null,
    },
  };
}

/**
 * Crisis-mode recovery. Backstop with fixed helpline if the LLM fails.
 */
async function recoverWithCrisisMode(input = {}) {
  const first = await runRecoveryLoop({ ...input, mode: 'crisis' });
  if (first.ok) {
    const rendered = renderEnvelope(first.envelope, { toolTrace: first.toolTrace });
    return {
      ok: true,
      source: 'crisis_mode_llm',
      envelope: first.envelope,
      prompt: first.prompt,
      toolTrace: first.toolTrace,
      rendered,
      loopResult: first.loopResult,
      setCrisisLocked: true,
    };
  }

  const second = await runRecoveryLoop({
    ...input,
    mode: 'crisis',
    repairHint:
      'Your crisis reply MUST include the exact words Tele-MANAS and 14416. intent=escalate. No counselling questions.',
  });
  if (second.ok) {
    const rendered = renderEnvelope(second.envelope, { toolTrace: second.toolTrace });
    return {
      ok: true,
      source: 'crisis_mode_llm_retry',
      envelope: second.envelope,
      prompt: second.prompt,
      toolTrace: second.toolTrace,
      rendered,
      loopResult: second.loopResult,
      setCrisisLocked: true,
    };
  }

  return {
    ok: false,
    source: 'crisis_backstop',
    reason: second.reason || first.reason || 'crisis_llm_failed',
    prompt: second.prompt || first.prompt || null,
    toolTrace: second.toolTrace || first.toolTrace || [],
    rendered: {
      replyText: CRISIS_BACKSTOP,
      replyParts: [CRISIS_BACKSTOP],
      interactive: null,
      replyMedia: null,
    },
    setCrisisLocked: true,
  };
}

module.exports = {
  recoverWithSafeMode,
  recoverWithCrisisMode,
  lightValidate,
  OUTAGE_APOLOGY,
  CRISIS_BACKSTOP,
};
