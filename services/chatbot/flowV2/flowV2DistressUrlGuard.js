'use strict';

/**
 * Distress-turn booking-URL suppression (hotfix/distress-turn-url-suppression).
 *
 * R7-T1 and interrupt-resume prepend a soft line and push the stage reply into
 * a later text part. Once multipart delivery is live, that would hand a student
 * in distress a booking URL as bubble 2. Required behaviour: on those turns,
 * emit NO booking URL in any part / position. Empathy (or interrupt
 * confirmation) still delivers; booking remains available on a later turn.
 *
 * NOTE (G-7, deferred): Flow V2 Node 0 still hardcodes
 * `https://www.guidexpert.co.in/one-on-one-session` in node0Override.js and
 * bypasses Phase 13 allowUrl + BOOKING_SERVICE_REGISTRY. This hotfix does not
 * consolidate those URLs — it only suppresses them on distress-prefixed turns.
 */

const BOOKING_URL_PATTERN = /guidexpert\.co\.in\/one-on-one-session/i;
const GENERIC_HTTP_URL_PATTERN = /https?:\/\/\S+/i;

function textContainsBookingUrl(text) {
  const t = String(text || '');
  if (!t) return false;
  // Primary: the live Flow V2 booking form. Also treat any http(s) URL in a
  // reply part as booking-adjacent for this guard — distress turns must not
  // ship a URL of any kind as a follow-on bubble.
  return BOOKING_URL_PATTERN.test(t) || GENERIC_HTTP_URL_PATTERN.test(t);
}

function collectTextParts(result = {}) {
  const parts = [];
  if (result.replyText) parts.push(String(result.replyText));
  if (Array.isArray(result.replyParts)) {
    for (const part of result.replyParts) {
      if (part != null && String(part).trim()) parts.push(String(part));
    }
  }
  return parts;
}

function resultContainsBookingUrl(result = {}) {
  if (collectTextParts(result).some(textContainsBookingUrl)) return true;
  if (textContainsBookingUrl(result.interactive?.body)) return true;
  return false;
}

/**
 * Prepend `prefix` to fallthrough. If fallthrough would emit a booking URL,
 * drop every URL-bearing part and the handoff interactive, keep `prefix`, and
 * freeze stage/profile to the pre-fallthrough values so link_sent / awaiting_done
 * do not stick without a delivered URL.
 *
 * @param {{
 *   prefix: string,
 *   fallthrough: object,
 *   preserveStage: string|null,
 *   preserveProfile: object,
 *   preserveHybridSlotOffers?: object[]|null,
 * }} args
 */
function combineWithDistressUrlSuppression({
  prefix,
  fallthrough,
  preserveStage,
  preserveProfile,
  preserveHybridSlotOffers = undefined,
}) {
  const prefixLine = String(prefix || '').trim();
  if (!resultContainsBookingUrl(fallthrough)) {
    const rest = collectTextParts(fallthrough);
    return {
      ...fallthrough,
      replyText: null,
      replyParts: prefixLine ? [prefixLine, ...rest] : rest,
    };
  }

  const contextPatch = {
    ...(fallthrough.contextPatch || {}),
    stage: preserveStage,
    profile: preserveProfile,
  };
  if (preserveHybridSlotOffers !== undefined) {
    contextPatch.hybridSlotOffers = preserveHybridSlotOffers;
  }

  return {
    ...fallthrough,
    replyText: null,
    replyParts: prefixLine ? [prefixLine] : [],
    interactive: null,
    contextPatch,
  };
}

module.exports = {
  BOOKING_URL_PATTERN,
  textContainsBookingUrl,
  resultContainsBookingUrl,
  collectTextParts,
  combineWithDistressUrlSuppression,
};
