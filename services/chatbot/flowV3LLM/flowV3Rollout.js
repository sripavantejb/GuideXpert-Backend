'use strict';

/**
 * Flow V3 rollout controls — kill switch, shadow/live mode, canary cohort.
 *
 * CHATBOT_FLOW_V3_ENABLED=0 → V3 never starts for NEW conversations.
 * CHATBOT_FLOW_V3_MODE=shadow|live (default shadow when enabled).
 * CHATBOT_FLOW_V3_CANARY_PERCENT=0..100 (live cohort by phone hash).
 *
 * Locked canary steps (architecture §12): 5 → 25 → 100.
 */

const crypto = require('crypto');

const CANARY_STEPS = Object.freeze([5, 25, 100]);

function isFlowV3Enabled() {
  return String(process.env.CHATBOT_FLOW_V3_ENABLED || '0').trim() === '1';
}

function getFlowV3Mode() {
  const mode = String(process.env.CHATBOT_FLOW_V3_MODE || 'shadow').trim().toLowerCase();
  return mode === 'live' ? 'live' : 'shadow';
}

function getCanaryPercent() {
  const n = Number(process.env.CHATBOT_FLOW_V3_CANARY_PERCENT);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.floor(n);
}

/**
 * Stable 0..99 bucket from phone (conversation-pinned externally at turn 1).
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
  // In-flight pin wins (kill switch does not tear down pinned V3).
  if (pinnedEngine === 'flow_v3') {
    return {
      useV3: true,
      mode: pinnedMode === 'live' ? 'live' : 'shadow',
      reason: 'pinned',
    };
  }
  if (pinnedEngine === 'flow_v2') {
    return { useV3: false, mode: null, reason: 'pinned_v2' };
  }

  if (!isFlowV3Enabled()) {
    return { useV3: false, mode: null, reason: 'disabled' };
  }

  const mode = getFlowV3Mode();
  if (mode === 'shadow') {
    return { useV3: true, mode: 'shadow', reason: 'shadow_all' };
  }

  const pct = getCanaryPercent();
  if (pct <= 0) {
    return { useV3: false, mode: null, reason: 'canary_zero', canaryPercent: 0 };
  }
  const bucket = phoneCanaryBucket(phone);
  if (bucket < pct) {
    return { useV3: true, mode: 'live', reason: 'canary_hit', canaryPercent: pct, bucket };
  }
  return { useV3: false, mode: null, reason: 'canary_miss', canaryPercent: pct, bucket };
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
