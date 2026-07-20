'use strict';

/**
 * Human handoff intent — explicit request only.
 * Must NOT match identity questions ("Are you human?") or casual phrases
 * ("Talk later", "Support", "Need support", "Help").
 * Explicit handoff examples: AGENT, "Talk to my counsellor", "Connect me to an agent".
 */

const { normalizeText } = require('../intentTextUtils');

function intentTextCandidates(text, originalText = null) {
  const normalized = normalizeText(text);
  const original = originalText ? normalizeText(originalText) : null;
  if (original && original !== normalized) {
    return [normalized, original];
  }
  return [normalized];
}

const HUMAN_HANDOFF_PATTERNS = [
  /\btalk to (a |my |the )?(counsellor|counselor|agent|human|person|someone|support)\b/i,
  /\b(connect|connected) (me )?(to |with )?(a |an |the )?(counsellor|counselor|agent|human|person|support)\b/i,
  /\b(assign|assigned) (me )?(a |an |the )?(counsellor|counselor|agent|human)\b/i,
  /\bhuman (support|agent|counsellor|counselor|help)\b/i,
  /\b(need|want|please) (a |an )?real person\b/i,
  /\breal (person|human|agent|counsellor|counselor)\b/i,
  /\b(call me|please call)\b/i,
  /\bescalate\b/i,
  /\b(agent|counsellor|counselor)\s*please\b/i,
  /^(agent|counsellor|counselor)$/i,
  /\btalk to my counsellor\b/i,
  /\bconnect me to an agent\b/i,
];

/** Phrases that contain "human"/"support"/"talk" but are NOT handoff. */
const HUMAN_HANDOFF_EXCLUSIONS = [
  /\bare you (a )?human\b/i,
  /\bare you (an )?ai\b/i,
  /\bare you chatgpt\b/i,
  /\bwho are you\b/i,
  /\bwhat are you\b/i,
  /\btalk later\b/i,
  /\bcatch you later\b/i,
  /\bsee you later\b/i,
  /^support$/i,
  /^help$/i,
  /^menu$/i,
];

function isExplicitHumanHandoffRequest(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((candidate) => {
    if (!candidate) return false;
    if (HUMAN_HANDOFF_EXCLUSIONS.some((re) => re.test(candidate))) return false;
    return HUMAN_HANDOFF_PATTERNS.some((re) => re.test(candidate));
  });
}

function isHumanHandoffMenuDigit(text, productLine) {
  const t = normalizeText(text);
  if (productLine === 'iit_counselling' && /^6$/.test(t)) return true;
  if (productLine === 'guidexpert' && /^6$/.test(t)) return true;
  if (productLine === 'unknown' && /^4$/.test(t)) return true;
  return false;
}

module.exports = {
  HUMAN_HANDOFF_PATTERNS,
  isExplicitHumanHandoffRequest,
  isHumanHandoffMenuDigit,
};
