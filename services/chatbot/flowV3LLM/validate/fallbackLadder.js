'use strict';

/**
 * Fallback ladder (architecture §7.3).
 */

const { nextFlowV3Slot } = require('../profile/flowV3NextSlot');
const { beatCopyForSlot } = require('./fallbackBeatCopy');

const HOLDING_REPLY =
  "Let me get a counsellor to answer that properly — I'll connect you shortly.";
const STATIC_ACK = "Got it — I'm still here with you. One moment.";

/**
 * @param {{ profile?: object, slotMeta?: object, reason?: string }} input
 * @returns {{ tier: 'A'|'B'|'C', replyText: string, replyParts: string[], intent: string, escalate?: boolean }}
 */
function runFallbackLadder(input = {}) {
  const profile = input.profile || {};
  let slot = null;
  let slotError = null;
  try {
    slot = nextFlowV3Slot(profile, { slotMeta: input.slotMeta || {} });
  } catch (err) {
    // F-9: a broken slot engine degrades every fallback to Tier B — that is a
    // visible incident, not a silent downgrade.
    slotError = err && err.message ? err.message : String(err);
    console.error('[flowV3] FALLBACK_SLOT_ENGINE_FAILED', { error: slotError });
    slot = null;
  }

  // Tier A — re-ask the current slot with the VERBATIM Flow V2 beat copy
  // (F-4). `slot.askable` is a boolean, never copy; the previous
  // `slot.askable || <template>` emitted the string "true" or an invented
  // template. A slot without V2 copy falls through to Tier B — the ladder
  // never writes its own student-facing copy.
  let beatCopyMissing = false;
  if (input.reason !== 'free_form' && slot && slot.slot && !slot.done && slot.askable === true) {
    const ask = beatCopyForSlot(slot.slot);
    if (ask) {
      return {
        tier: 'A',
        replyText: ask,
        replyParts: [ask],
        intent: 'ask_slot',
        slot: slot.slot,
        reason: input.reason || null,
      };
    }
    beatCopyMissing = true;
    console.error('[flowV3] FALLBACK_NO_BEAT_COPY', { slot: slot.slot });
  }

  if (input.reason === 'free_form' || !slot || slot.done || beatCopyMissing) {
    return {
      tier: 'B',
      replyText: HOLDING_REPLY,
      replyParts: [HOLDING_REPLY],
      intent: 'escalate',
      escalate: true,
      reason: input.reason || null,
      slotError,
    };
  }

  return {
    tier: 'C',
    replyText: STATIC_ACK,
    replyParts: [STATIC_ACK],
    intent: 'answer_question',
    reason: input.reason || null,
  };
}

module.exports = {
  HOLDING_REPLY,
  STATIC_ACK,
  runFallbackLadder,
};
