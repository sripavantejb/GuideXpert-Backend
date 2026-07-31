'use strict';

/**
 * Fallback ladder (architecture §7.3).
 */

const { nextFlowV3Slot } = require('../profile/flowV3NextSlot');

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
  try {
    slot = nextFlowV3Slot(profile, { slotMeta: input.slotMeta || {} });
  } catch {
    slot = null;
  }

  if (slot && slot.slot && !slot.done) {
    // NOTE: slot.askable is a boolean flag (may this slot be asked?), NOT ask
    // copy — using it as text sent the literal string "true" to students.
    const ask = `Quick check — can you share your ${slot.slot.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}?`;
    return {
      tier: 'A',
      replyText: ask,
      replyParts: [ask],
      intent: 'ask_slot',
      slot: slot.slot,
      reason: input.reason || null,
    };
  }

  if (input.reason === 'free_form' || !slot || slot.done) {
    return {
      tier: 'B',
      replyText: HOLDING_REPLY,
      replyParts: [HOLDING_REPLY],
      intent: 'escalate',
      escalate: true,
      reason: input.reason || null,
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
