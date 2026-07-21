'use strict';

/**
 * Shared permission-gate affirmative / negative detection.
 * Used across Stages 3–13 so the FIRST valid reply always advances.
 */

const { normalizeText } = require('./intentTextUtils');
const { logChatbotEvent } = require('./chatbotStructuredLog');

/** Zero-width / BOM / NBSP — common on mobile WhatsApp keyboards. */
function stripInvisibleChars(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00A0]/g, '')
    .normalize('NFKC');
}

function normalizePermissionText(text) {
  return normalizeText(stripInvisibleChars(text));
}

/**
 * True for student permission / continue affirmatives.
 * Accepts soft phrases ("yes please", "let's do it") — not only exact tokens.
 */
function isPermissionAffirmative(text) {
  const t = normalizePermissionText(text);
  if (!t) return false;

  if (
    /^(yes|yeah|yep|yup|y|sure|ok|okay|please|continue|proceed|ready|next|go ahead|absolutely|definitely|shortlist|compare|show|narrow|personalize|book|book now)\b/i.test(
      t
    )
  ) {
    return true;
  }

  if (/^(yes|yeah|yep|yup|sure|ok|okay)\b.{0,24}$/i.test(t)) return true;
  if (/^(let'?s|lets) (do it|go|continue|proceed|shortlist|compare|book)\b/i.test(t)) {
    return true;
  }
  if (/^(i('m| am)? )?(ready|in)\b/i.test(t) && t.length <= 24) return true;

  return false;
}

function isPermissionNegative(text) {
  const t = normalizePermissionText(text);
  if (!t) return false;
  return /^(no|nope|not now|later|nah|n|not yet|skip)\b/i.test(t);
}

/**
 * Short acks reused at every permission gate.
 * Must NEVER be discarded by cross-turn recent-utterance dedupe — dual delivery
 * is already handled by webhook content-hash keys within the same time bucket.
 */
function isShortPermissionAckUtterance(text) {
  const t = normalizePermissionText(text);
  if (!t || t.length > 48) return false;
  return /^(yes|yeah|yep|yup|y|ok|okay|sure|continue|proceed|ready|next|go ahead|please|no|nope|n|later|not now|skip|done|thanks|thank you|book|book now|lets go|let'?s go|yes please|lets do it|let'?s do it)([.!?]*)?$/i.test(
    t
  );
}

const PERMISSION_WAITING_STEPS = Object.freeze(
  new Set([
    'eval_ask_permission',
    'eval_offer_personalization',
    'modern_condensed',
    'modern_ask_learning_style',
    'explore_ask_continue',
    'explore_present',
    'pers_ask_permission',
    'shortlist_ask_compare',
    'compare_ask_recommendation',
    'concern_ask_continue',
    'phase9_present',
    'phase9_followup',
    'vision_followup',
    'vision_present',
    'counsel_rec_followup',
    'counsel_rec_present',
    'booking_intro',
    'invite_present',
    'invite_followup',
  ])
);

/**
 * Production instrumentation for permission gates.
 * Makes missed first-yes failures visible in structured logs.
 */
function logPermissionGateTransition(fields = {}) {
  logChatbotEvent('permission_gate_transition', {
    conversationId: fields.conversationId || null,
    phoneTail: fields.phoneTail || null,
    currentStage: fields.currentStage || null,
    currentStep: fields.currentStep || null,
    inboundText: String(fields.inboundText || '').slice(0, 120),
    permissionMatched: Boolean(fields.permissionMatched),
    oldState: fields.oldState || null,
    newState: fields.newState || null,
    replyGenerated: Boolean(fields.replyGenerated),
    replySent: fields.replySent == null ? null : Boolean(fields.replySent),
    statePersisted: fields.statePersisted == null ? null : Boolean(fields.statePersisted),
    advanced: Boolean(fields.advanced),
  });
}

function isPermissionWaitingStep(step) {
  return PERMISSION_WAITING_STEPS.has(String(step || ''));
}

module.exports = {
  stripInvisibleChars,
  normalizePermissionText,
  isPermissionAffirmative,
  isPermissionNegative,
  isShortPermissionAckUtterance,
  isPermissionWaitingStep,
  logPermissionGateTransition,
  PERMISSION_WAITING_STEPS,
};
