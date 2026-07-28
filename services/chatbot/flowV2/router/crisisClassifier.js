'use strict';

/**
 * Flow V3 — I-10 genuine-distress classifier (Master Flow Part 11 / R7 Tier 2).
 *
 * Dependency-free leaf. `flowV2Dispatcher.processFlowV2Turn()` calls
 * `isTier2Crisis()` before Node 0, before slot extraction, and before
 * `classifyReply()`. Distress is a pipeline pre-check — it overrides Node 0
 * and every other rule. Tele-MANAS 14416 copy lives in r7Tier2Handler.
 *
 * Patterns remain conservative and high-precision. Tier-1 disappointment
 * belongs to the ordinary router and is intentionally absent here.
 */
const R7_TIER2_CRISIS_PATTERNS = Object.freeze([
  /\bmy life is over\b/i,
  /\bno point (in )?living\b/i,
  /\bno point (in )?going on\b/i,
  /\beveryone( would| will)? be better off without me\b/i,
  /\bi want to (die|end it all|end my life)\b/i,
  /\b(want|going) to kill myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\bcan'?t (take it anymore|go on anymore|do this anymore)\b/i,
  /\bi('m| am) done with (life|everything)\b/i,
  /\bnothing matters anymore\b/i,
  /\bi don'?t want to (live|be alive) anymore\b/i,
  /\bself[- ]harm\b/i,
]);

function isTier2Crisis(text) {
  const value = String(text || '');
  return R7_TIER2_CRISIS_PATTERNS.some((pattern) => pattern.test(value));
}

module.exports = {
  isTier2Crisis,
  R7_TIER2_CRISIS_PATTERNS,
};
