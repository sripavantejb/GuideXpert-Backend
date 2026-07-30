'use strict';

/**
 * Turn context assembly (§3 step 8) — provider-agnostic.
 *
 * Produces a plain object: pinned prompt identity, the profile the model may
 * see, the next-slot hint, the history window, the rolling summary, WhatsApp
 * shape constraints and the tool allowlist. It does NOT build provider messages
 * and does NOT call a model; that framing is llmLoop's job (blocked on D-1/D-2).
 *
 * Two contract rules are enforced here rather than trusted to the prompt:
 *   - inferred values are marked, never presented as stated fact;
 *   - Tier 4 (crisis, accessibility) is never sent to a model, and Tier 3
 *     (category, gender …) is admitted only on a turn whose declared purpose
 *     the retention policy allows.
 */

const { buildHistoryWindow } = require('./historyWindow');
const { resolvePinnedVersion, loadPrompt } = require('../../flowV3LLM/llm/promptLoader');
const { FLOW_V3_TOOL_ALLOWLIST } = require('../tools/toolBroker');
const { nextFlowV3Slot } = require('../profile/flowV3NextSlot');
const { partitionStatedVsInferred } = require('../profile/flowV3ProfileAuthority');
const {
  fieldsExcludedFromLlmPrompt,
  checkTier3Purpose,
  listFieldsForTier,
} = require('../profile/flowV3RetentionPolicy');
const { buildReadViews } = require('../profile');

/** WhatsApp shape constraints — the render layer enforces these too. */
const WHATSAPP_CONSTRAINTS = Object.freeze({
  maxParts: 3,
  maxCharsPerPart: 700,
  maxButtons: 3,
  maxButtonLabelChars: 20,
  maxListRows: 10,
});

/**
 * @param {object} profile
 * @param {{ purpose?: string|null }} [options] the purpose this turn serves.
 *        Tier 3 (category, gender, isMinor …) is admitted ONLY for the purposes
 *        the retention policy allows — cutoff computation and the S-1 gate. On
 *        every other turn those fields are withheld, which is what makes
 *        "purpose-limited" a property of the code rather than of the prompt.
 *        Withholding is safe: the S-1 gate and the predictor both read the full
 *        profile server-side and never depend on the model seeing it.
 */
function redactForPrompt(profile = {}, options = {}) {
  const excluded = new Set(fieldsExcludedFromLlmPrompt());

  const tier3Check = checkTier3Purpose(options.purpose || null);
  if (!tier3Check.allowed) {
    for (const field of listFieldsForTier(3)) excluded.add(field);
  }

  const visible = {};
  const withheld = [];
  for (const [key, value] of Object.entries(profile || {})) {
    if (excluded.has(key)) {
      withheld.push(key);
      continue;
    }
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    visible[key] = value;
  }
  return { visible, withheld };
}

/**
 * @param {{
 *   profile?: object,
 *   slotMeta?: object,
 *   turns?: Array,
 *   summary?: string|null,
 *   promptVersion?: string|null,
 *   academicYear?: number|null,
 *   toolsAvailable?: string[],
 * }} input
 * @param {{ dir?: string, windowTurns?: number, loadPromptText?: boolean }} [options]
 */
function buildTurnContext(input = {}, options = {}) {
  const profile = input.profile || {};
  const slotMeta = input.slotMeta || {};

  const promptVersion = resolvePinnedVersion(input.promptVersion || null, options);
  let prompt = { version: promptVersion, hash: null, text: null, missing: true };
  if (options.loadPromptText !== false) {
    try {
      const loaded = loadPrompt(promptVersion, options);
      prompt = { version: loaded.version, hash: loaded.hash, text: loaded.text, missing: false };
    } catch (err) {
      // Missing prompt is surfaced, never substituted with invented copy.
      prompt = { version: promptVersion, hash: null, text: null, missing: true, error: err.code };
    }
  }

  const { visible, withheld } = redactForPrompt(profile, { purpose: input.purpose || null });
  const authority = partitionStatedVsInferred(profile, slotMeta);
  const history = buildHistoryWindow(input.turns || [], options);
  const nextSlot = nextFlowV3Slot(profile, {
    slotMeta,
    academicYear: input.academicYear ?? null,
  });

  return {
    prompt,
    profile: {
      visible,
      withheldFields: withheld,
      statedFields: authority.stated ? Object.keys(authority.stated) : [],
      inferredFields: authority.inferred ? Object.keys(authority.inferred) : [],
      readViews: buildReadViews(profile),
    },
    nextSlot,
    history,
    summary: input.summary || null,
    constraints: WHATSAPP_CONSTRAINTS,
    tools: Array.isArray(input.toolsAvailable) ? input.toolsAvailable : [...FLOW_V3_TOOL_ALLOWLIST],
    academicYear: input.academicYear ?? null,
  };
}

module.exports = {
  WHATSAPP_CONSTRAINTS,
  buildTurnContext,
  redactForPrompt,
};
