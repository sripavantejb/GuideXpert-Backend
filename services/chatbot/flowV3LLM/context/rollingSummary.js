'use strict';

/**
 * Rolling conversation summary — POLICY ONLY (regenerate every N turns).
 *
 * The generator itself is injected. Until the provider is chosen (D-1/D-2) the
 * deterministic extractive fallback is used, so nothing here depends on a model
 * or on tool-calling semantics.
 */

const REGENERATE_EVERY_TURNS = 6;
const MAX_SUMMARY_CHARS = 1200;

/**
 * @param {{ summary?: string|null, summaryTurnCount?: number, turnCount?: number }} state
 * @returns {{ shouldRegenerate: boolean, reason: string }}
 */
function shouldRegenerateSummary(state = {}, options = {}) {
  const every = Number(options.every) > 0 ? Number(options.every) : REGENERATE_EVERY_TURNS;
  const turnCount = Number(state.turnCount || 0);
  const summaryTurnCount = Number(state.summaryTurnCount || 0);

  if (!state.summary) {
    return { shouldRegenerate: turnCount > 0, reason: turnCount > 0 ? 'no_summary_yet' : 'no_turns' };
  }
  if (turnCount - summaryTurnCount >= every) {
    return { shouldRegenerate: true, reason: 'turn_interval_reached' };
  }
  return { shouldRegenerate: false, reason: 'within_interval' };
}

/**
 * Deterministic extractive summary — no LLM. Used until a provider is chosen,
 * and as the fallback when generation fails or times out.
 */
function buildExtractiveSummary(turns = [], options = {}) {
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : MAX_SUMMARY_CHARS;
  const studentTurns = (Array.isArray(turns) ? turns : []).filter(
    (t) => t && t.role !== 'bot' && t.role !== 'assistant' && String(t.text || '').trim()
  );
  const lines = studentTurns.map((t) => `- ${String(t.text).trim().replace(/\s+/g, ' ')}`);

  let out = '';
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = out ? `${lines[i]}\n${out}` : lines[i];
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  return out;
}

/**
 * @param {object} state { summary, summaryTurnCount, turnCount }
 * @param {Array} turns
 * @param {{ generate?: Function, every?: number, maxChars?: number }} [options]
 *        `generate` is the injected (future) LLM summariser; on throw/timeout
 *        the extractive summary is used instead.
 */
async function updateRollingSummary(state = {}, turns = [], options = {}) {
  const decision = shouldRegenerateSummary(state, options);
  if (!decision.shouldRegenerate) {
    return {
      summary: state.summary || null,
      summaryTurnCount: Number(state.summaryTurnCount || 0),
      regenerated: false,
      reason: decision.reason,
      source: 'unchanged',
    };
  }

  let summary = null;
  let source = 'extractive';
  if (typeof options.generate === 'function') {
    try {
      const generated = await options.generate({ state, turns });
      if (generated && String(generated).trim()) {
        summary = String(generated).trim().slice(0, options.maxChars || MAX_SUMMARY_CHARS);
        source = 'generated';
      }
    } catch {
      summary = null;
    }
  }
  if (!summary) summary = buildExtractiveSummary(turns, options);

  return {
    summary,
    summaryTurnCount: Number(state.turnCount || 0),
    regenerated: true,
    reason: decision.reason,
    source,
  };
}

module.exports = {
  REGENERATE_EVERY_TURNS,
  MAX_SUMMARY_CHARS,
  shouldRegenerateSummary,
  buildExtractiveSummary,
  updateRollingSummary,
};
