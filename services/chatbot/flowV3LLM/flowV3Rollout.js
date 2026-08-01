'use strict';

/**
 * Flow V3 rollout controls.
 *
 * V3 (LLM engine) is UNCONDITIONAL for all counselling. Env vars
 * CHATBOT_FLOW_V3_ENABLED / MODE / CANARY_PERCENT are ignored so stale
 * Vercel overrides can never route anyone back to Flow V2.
 *
 * Flow V2 remains only as frozen library code that V3 reuses
 * (slot extractor, nextSlot walk, fallback beat copy).
 *
 * Helpers phoneCanaryBucket / nextCanaryStep / CANARY_STEPS are kept for
 * ops tooling and tests; they no longer gate live traffic.
 */

const crypto = require('crypto');

const CANARY_STEPS = Object.freeze([5, 25, 100]);

function isFlowV3Enabled() {
  return true;
}

function getFlowV3Mode() {
  return 'live';
}

function getCanaryPercent() {
  return 100;
}

/**
 * Stable 0..99 bucket from phone (ops helper; unused for live gating).
 */
function phoneCanaryBucket(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!digits) return 100;
  const digest = crypto.createHash('sha256').update(`flowv3-canary:${digits}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Next locked canary step after `current` (ops helper; does not mutate env).
 * @param {number} current
 * @returns {number|null}
 */
function nextCanaryStep(current = 0) {
  const n = Number(current) || 0;
  for (const step of CANARY_STEPS) {
    if (step > n) return step;
  }
  return null;
}

/**
 * @returns {{ useV3: boolean, mode: 'shadow'|'live'|null, reason: string, canaryPercent?: number, bucket?: number }}
 */
function resolveFlowV3Routing({ phone, pinnedEngine = null, pinnedMode = null } = {}) {
  // Preserve pin reason for in-flight V3 conversations (observability).
  if (pinnedEngine === 'flow_v3') {
    return {
      useV3: true,
      mode: 'live',
      reason: 'pinned',
    };
  }

  void phone;
  void pinnedMode;
  return {
    useV3: true,
    mode: 'live',
    reason: 'forced_live',
    canaryPercent: 100,
  };
}

module.exports = {
  CANARY_STEPS,
  isFlowV3Enabled,
  getFlowV3Mode,
  getCanaryPercent,
  phoneCanaryBucket,
  nextCanaryStep,
  resolveFlowV3Routing,
};
