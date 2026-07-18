'use strict';

/**
 * Expanded campaign config. Core eligibility intervals/maxAttempts defaults unchanged.
 */

const MESSAGE_KIND = 'conversation_recovery';

const DEFAULT_CONFIG = Object.freeze({
  featureEnabled: process.env.CONVERSATION_RECOVERY_ENABLED !== 'false',
  intervalsHours: Object.freeze([24, 72, 168]),
  maxAttempts: 3,
  inactivityBaseHours: 24,
  templateIdEnvKey: 'GUPSHUP_TEMPLATE_CONVERSATION_RECOVERY',
  awaitingReplyWindowHours: 72,
  timezone: 'Asia/Kolkata',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  sendWindowEnabled: false,
  sendWindowStart: '09:00',
  sendWindowEnd: '20:00',
  dailySendLimit: 0, // 0 = unlimited
  alertDeliverySuccessMin: 0.7,
  alertFailureRateMax: 0.25,
  alertQueueBacklogMax: 200,
  alertSchedulerStaleMinutes: 45,
  alertDlrMissingMinutes: 60,
});

let runtimeOverrides = {};

function asBool(v, fallback) {
  if (v == null) return fallback;
  return Boolean(v);
}

function asInt(v, fallback, { min = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function asFloat(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getConversationRecoveryConfig() {
  const intervals = Array.isArray(runtimeOverrides.intervalsHours)
    ? runtimeOverrides.intervalsHours.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [...DEFAULT_CONFIG.intervalsHours];
  const maxAttempts = Number(runtimeOverrides.maxAttempts);

  // delay / retryInterval aliases map onto intervalsHours without changing eligibility API
  let intervalsHours = intervals.length ? intervals : [...DEFAULT_CONFIG.intervalsHours];
  if (runtimeOverrides.delayHours != null || runtimeOverrides.retryIntervalHours != null) {
    const delay = asInt(runtimeOverrides.delayHours, intervalsHours[0] || 24, { min: 1 });
    const retry = asInt(
      runtimeOverrides.retryIntervalHours,
      intervalsHours[1] || 72,
      { min: 1 }
    );
    const third = intervalsHours[2] || 168;
    intervalsHours = [delay, retry, third];
  }

  return {
    featureEnabled:
      runtimeOverrides.featureEnabled != null
        ? Boolean(runtimeOverrides.featureEnabled)
        : DEFAULT_CONFIG.featureEnabled,
    intervalsHours,
    maxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0
        ? Math.floor(maxAttempts)
        : DEFAULT_CONFIG.maxAttempts,
    inactivityBaseHours: DEFAULT_CONFIG.inactivityBaseHours,
    templateIdEnvKey: DEFAULT_CONFIG.templateIdEnvKey,
    templateId: process.env[DEFAULT_CONFIG.templateIdEnvKey] || null,
    awaitingReplyWindowHours: DEFAULT_CONFIG.awaitingReplyWindowHours,
    messageKind: MESSAGE_KIND,
    campaign: MESSAGE_KIND,
    timezone: runtimeOverrides.timezone || DEFAULT_CONFIG.timezone,
    quietHoursEnabled: asBool(
      runtimeOverrides.quietHoursEnabled,
      DEFAULT_CONFIG.quietHoursEnabled
    ),
    quietHoursStart:
      runtimeOverrides.quietHoursStart || DEFAULT_CONFIG.quietHoursStart,
    quietHoursEnd: runtimeOverrides.quietHoursEnd || DEFAULT_CONFIG.quietHoursEnd,
    sendWindowEnabled: asBool(
      runtimeOverrides.sendWindowEnabled,
      DEFAULT_CONFIG.sendWindowEnabled
    ),
    sendWindowStart:
      runtimeOverrides.sendWindowStart || DEFAULT_CONFIG.sendWindowStart,
    sendWindowEnd: runtimeOverrides.sendWindowEnd || DEFAULT_CONFIG.sendWindowEnd,
    dailySendLimit: asInt(
      runtimeOverrides.dailySendLimit,
      DEFAULT_CONFIG.dailySendLimit,
      { min: 0 }
    ),
    delayHours: intervalsHours[0],
    retryIntervalHours: intervalsHours[1] || intervalsHours[0],
    alertDeliverySuccessMin: asFloat(
      runtimeOverrides.alertDeliverySuccessMin,
      DEFAULT_CONFIG.alertDeliverySuccessMin
    ),
    alertFailureRateMax: asFloat(
      runtimeOverrides.alertFailureRateMax,
      DEFAULT_CONFIG.alertFailureRateMax
    ),
    alertQueueBacklogMax: asInt(
      runtimeOverrides.alertQueueBacklogMax,
      DEFAULT_CONFIG.alertQueueBacklogMax,
      { min: 1 }
    ),
    alertSchedulerStaleMinutes: asInt(
      runtimeOverrides.alertSchedulerStaleMinutes,
      DEFAULT_CONFIG.alertSchedulerStaleMinutes,
      { min: 5 }
    ),
    alertDlrMissingMinutes: asInt(
      runtimeOverrides.alertDlrMissingMinutes,
      DEFAULT_CONFIG.alertDlrMissingMinutes,
      { min: 5 }
    ),
  };
}

function setConversationRecoveryConfigOverrides(patch = {}) {
  runtimeOverrides = {
    ...runtimeOverrides,
    ...patch,
  };
  return getConversationRecoveryConfig();
}

function resetConversationRecoveryConfigOverrides() {
  runtimeOverrides = {};
  return getConversationRecoveryConfig();
}

module.exports = {
  MESSAGE_KIND,
  DEFAULT_CONFIG,
  getConversationRecoveryConfig,
  setConversationRecoveryConfigOverrides,
  resetConversationRecoveryConfigOverrides,
};
