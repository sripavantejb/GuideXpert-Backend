'use strict';

const AppSettings = require('../models/AppSettings');
const {
  getConversationRecoveryConfig,
  setConversationRecoveryConfigOverrides,
} = require('../services/conversationRecovery/conversationRecoveryConfig');

const CONVERSATION_RECOVERY_CONFIG_KEY = 'conversationRecoveryConfig';

const ALLOWED_KEYS = [
  'featureEnabled',
  'intervalsHours',
  'maxAttempts',
  'delayHours',
  'retryIntervalHours',
  'timezone',
  'quietHoursEnabled',
  'quietHoursStart',
  'quietHoursEnd',
  'sendWindowEnabled',
  'sendWindowStart',
  'sendWindowEnd',
  'dailySendLimit',
  'alertDeliverySuccessMin',
  'alertFailureRateMax',
  'alertQueueBacklogMax',
  'alertSchedulerStaleMinutes',
  'alertDlrMissingMinutes',
];

async function loadConversationRecoveryConfigFromStore() {
  try {
    const doc = await AppSettings.findOne({ key: CONVERSATION_RECOVERY_CONFIG_KEY }).lean();
    if (doc?.value && typeof doc.value === 'object') {
      setConversationRecoveryConfigOverrides(doc.value);
    }
  } catch (err) {
    console.warn(
      '[AppSettings] loadConversationRecoveryConfigFromStore failed:',
      err?.message || err
    );
  }
  return getConversationRecoveryConfig();
}

async function getPersistedConversationRecoveryConfig() {
  await loadConversationRecoveryConfigFromStore();
  return getConversationRecoveryConfig();
}

function sanitizePatch(patch = {}) {
  const allowed = {};
  if (patch.featureEnabled != null) allowed.featureEnabled = Boolean(patch.featureEnabled);
  if (Array.isArray(patch.intervalsHours)) {
    allowed.intervalsHours = patch.intervalsHours
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  if (patch.maxAttempts != null) {
    const n = Number(patch.maxAttempts);
    if (Number.isFinite(n) && n > 0) allowed.maxAttempts = Math.floor(n);
  }
  for (const key of [
    'delayHours',
    'retryIntervalHours',
    'dailySendLimit',
    'alertQueueBacklogMax',
    'alertSchedulerStaleMinutes',
    'alertDlrMissingMinutes',
  ]) {
    if (patch[key] != null) {
      const n = Number(patch[key]);
      if (Number.isFinite(n) && n >= 0) allowed[key] = Math.floor(n);
    }
  }
  for (const key of ['alertDeliverySuccessMin', 'alertFailureRateMax']) {
    if (patch[key] != null) {
      const n = Number(patch[key]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) allowed[key] = n;
    }
  }
  for (const key of [
    'timezone',
    'quietHoursStart',
    'quietHoursEnd',
    'sendWindowStart',
    'sendWindowEnd',
  ]) {
    if (patch[key] != null && String(patch[key]).trim()) {
      allowed[key] = String(patch[key]).trim();
    }
  }
  for (const key of ['quietHoursEnabled', 'sendWindowEnabled']) {
    if (patch[key] != null) allowed[key] = Boolean(patch[key]);
  }
  return allowed;
}

async function setPersistedConversationRecoveryConfig(patch = {}) {
  const allowed = sanitizePatch(patch);
  const existing = await AppSettings.findOne({ key: CONVERSATION_RECOVERY_CONFIG_KEY }).lean();
  const next = { ...(existing?.value || {}), ...allowed };
  await AppSettings.findOneAndUpdate(
    { key: CONVERSATION_RECOVERY_CONFIG_KEY },
    { key: CONVERSATION_RECOVERY_CONFIG_KEY, value: next },
    { upsert: true, new: true }
  );
  setConversationRecoveryConfigOverrides(next);
  return getConversationRecoveryConfig();
}

module.exports = {
  CONVERSATION_RECOVERY_CONFIG_KEY,
  ALLOWED_KEYS,
  loadConversationRecoveryConfigFromStore,
  getPersistedConversationRecoveryConfig,
  setPersistedConversationRecoveryConfig,
  sanitizePatch,
};
