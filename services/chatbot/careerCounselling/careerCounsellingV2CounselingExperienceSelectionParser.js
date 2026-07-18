'use strict';

const { normalizeText } = require('../intentTextUtils');

function isPhase12Continue(text) {
  const t = normalizeText(text);
  return /^(continue|yes|y|sure|ok|okay|lets continue|i want to (continue|book)|ready)$/i.test(
    t
  );
}

function isPhase12Decline(text) {
  const t = normalizeText(text);
  return /^(not now|no|n|nope|later|skip|done|finish|finished|thanks|thank you)$/i.test(
    t
  );
}

function isPhase12Question(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain)\b/i.test(raw);
}

module.exports = {
  isPhase12Continue,
  isPhase12Decline,
  isPhase12Question,
};
