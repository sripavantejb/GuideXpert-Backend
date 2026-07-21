'use strict';

const { normalizeText } = require('../intentTextUtils');
const {
  isPermissionAffirmative,
  normalizePermissionText,
} = require('../permissionAffirmative');

/**
 * Inside Phase 13: any booking-positive intent shares / re-shares the official URL.
 * Soft acks (yes/ready/sure) count here so we never ask for a second confirmation.
 */
function isPhase13BookNow(text) {
  if (isPermissionAffirmative(text)) return true;
  const t = normalizePermissionText(text);
  return /^(book now|book|yes book|lets book|i want to book|schedule now|send booking link|send (the )?link|give me (the )?booking form|booking form|i('m| am) interested)$/i.test(
    t
  );
}

/**
 * Cross-stage resume only — must NOT match soft continue/yes/ready.
 * Those belong to Phase 12 (last permission gate) and earlier stages.
 */
function isExplicitBookingLinkRequest(text) {
  const t = normalizePermissionText(text);
  if (!t) return false;
  return /^(book now|book|yes book|lets book|i want to book|schedule now|send booking link|send (the )?link|give me (the )?booking form|booking form)$/i.test(
    t
  ) || /\b(send booking link|give me (the )?booking form|schedule now|book now)\b/i.test(t);
}

/** Soft defer / not-now — does not include form Done or wrap-up. */
function isPhase13Defer(text) {
  const t = normalizeText(text);
  return /^(later|not now|no|n|nope|skip)$/i.test(t);
}

/**
 * Form-submit ack after URL share — stay engaged (do not close journey).
 * Distinct from wrap-up ("that's all", "bye", "done for now").
 */
function isPhase13FormDone(text) {
  const t = normalizeText(text);
  return /^(done|finish|finished|submitted|form (is )?done|i'?ve (submitted|done|finished)|i have (submitted|done|finished)|completed|form submitted)$/i.test(
    t
  );
}

/** Explicit conversation wrap-up → Phase 14 only. */
function isPhase13WrapUp(text) {
  const t = normalizeText(text);
  return /^(thanks|thank you|bye|goodbye|that'?s all|that is all|all done|done for now|nothing else|no more questions|i'?m done for now|i am done for now|wrap up|that'?s it|that is it)$/i.test(
    t
  );
}

function isPhase13Question(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (isPhase13BookNow(raw) || isPhase13FormDone(raw) || isPhase13Defer(raw) || isPhase13WrapUp(raw)) {
    return false;
  }
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain|where)\b/i.test(raw);
}

/**
 * Deterministic resume into Phase 13 — never replays Phases 9–12.
 * Only explicit link/book phrases (not soft yes/continue) so Phase 12 remains the last permission gate.
 */
function detectBookingResume(text) {
  const t = normalizeText(text);
  if (!t) return { matched: false, shareUrlImmediately: false };

  if (isExplicitBookingLinkRequest(text)) {
    return { matched: true, shareUrlImmediately: true, phrase: t };
  }

  return { matched: false, shareUrlImmediately: false };
}

module.exports = {
  isPhase13BookNow,
  isExplicitBookingLinkRequest,
  isPhase13Defer,
  isPhase13FormDone,
  isPhase13WrapUp,
  isPhase13Question,
  detectBookingResume,
};
