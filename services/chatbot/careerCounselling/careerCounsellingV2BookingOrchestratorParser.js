'use strict';

const { normalizeText } = require('../intentTextUtils');

function isPhase13BookNow(text) {
  const t = normalizeText(text);
  return /^(book now|book|yes book|lets book|i want to book|schedule now|send booking link|send (the )?link|give me (the )?booking form|booking form|im ready|i am ready)$/i.test(
    t
  );
}

function isPhase13Defer(text) {
  const t = normalizeText(text);
  return /^(later|not now|no|n|nope|skip|done|finish|finished|thanks|thank you)$/i.test(t);
}

function isPhase13Question(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain|where)\b/i.test(raw);
}

/**
 * Deterministic resume into Phase 13 — never replays Phases 9–12.
 * Link-seeking phrases share URL immediately after eligibility checks.
 */
function detectBookingResume(text) {
  const t = normalizeText(text);
  if (!t) return { matched: false, shareUrlImmediately: false };

  const linkSeeking =
    /^(book now|book|schedule now|send booking link|send (the )?link|give me (the )?booking form|booking form|im ready|i am ready)$/i.test(
      t
    ) ||
    /\b(send booking link|give me (the )?booking form|schedule now|book now)\b/i.test(t);

  if (linkSeeking) {
    return { matched: true, shareUrlImmediately: true, phrase: t };
  }

  return { matched: false, shareUrlImmediately: false };
}

module.exports = {
  isPhase13BookNow,
  isPhase13Defer,
  isPhase13Question,
  detectBookingResume,
};
