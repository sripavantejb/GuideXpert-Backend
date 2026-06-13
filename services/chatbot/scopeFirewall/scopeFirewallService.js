'use strict';

const {
  DENY_PATTERNS,
  ALLOW_SIGNAL_PATTERN,
  BRANCH_GUIDANCE_PATTERN,
} = require('./scopeFirewallConstants');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildCandidates(originalText, englishMessage) {
  const candidates = [];
  const original = normalizeText(originalText);
  const english = normalizeText(englishMessage);
  if (original) candidates.push(original);
  if (english && english !== original) candidates.push(english);
  return candidates;
}

function findDenyMatch(candidates) {
  for (const text of candidates) {
    for (const { category, pattern } of DENY_PATTERNS) {
      if (pattern.test(text)) {
        return category;
      }
    }
  }
  return null;
}

function hasAllowSignal(candidates) {
  return candidates.some(
    (text) => ALLOW_SIGNAL_PATTERN.test(text) || BRANCH_GUIDANCE_PATTERN.test(text)
  );
}

/**
 * Decide whether a message is in GuideXpert's counselling domain.
 *
 * @param {{ originalText?: string, englishMessage?: string, intent?: string, botState?: object }} params
 * @returns {{ allowed: boolean, category: string|null, reason: string }}
 */
function evaluateScope({ originalText, englishMessage } = {}) {
  const candidates = buildCandidates(originalText, englishMessage);

  if (candidates.length === 0) {
    return { allowed: true, category: null, reason: 'empty_message' };
  }

  const denyCategory = findDenyMatch(candidates);
  const allowSignal = hasAllowSignal(candidates);

  if (denyCategory && !allowSignal) {
    return { allowed: false, category: denyCategory, reason: 'deny_pattern' };
  }

  if (allowSignal) {
    return {
      allowed: true,
      category: denyCategory ? 'branch_guidance' : 'iit_counselling',
      reason: denyCategory ? 'allow_signal_override' : 'allow_signal',
    };
  }

  return { allowed: true, category: null, reason: 'no_deny_match' };
}

/**
 * Defense-in-depth helper for the Knowledge Assistant: returns true when the
 * raw text is clearly out of domain (deny pattern, no allow signal).
 */
function isOutOfDomain(text) {
  return evaluateScope({ originalText: text }).allowed === false;
}

module.exports = {
  evaluateScope,
  isOutOfDomain,
  normalizeText,
};
