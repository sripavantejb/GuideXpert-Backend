'use strict';

const INTEGRATION_DEFAULTS = {
  WA_INTEGRATION_STUB: '1',
  ENABLE_WHATSAPP: 'true',
  GUPSHUP_API_KEY: 'test-key',
  GUPSHUP_SOURCE: '15550000000',
  GUPSHUP_TEMPLATE_PRE4HR: 'test-pre4hr',
  GUPSHUP_TEMPLATE_MEET: 'test-meet',
  GUPSHUP_TEMPLATE_30MIN: 'test-30min',
  GUPSHUP_TEMPLATE_REMINDER: 'test-slot',
  WA_DLR_RECONCILE_STALE_MS: '1000',
  WA_DLR_RECONCILE_GRACE_MS: '2000',
  WA_REMINDER_JOB_CLAIM_TTL_MS: '3000',
  WA_REMINDER_JOB_BATCH_LIMIT: '50',
  WA_REMINDER_JOB_MAX_DISPATCH_PER_RUN: '50',
  WHATSAPP_CAMPAIGN_RETRY_MAX_WALL_MS: '60000',
  WHATSAPP_RETRY_COOLDOWN_MINUTES: '0',
  WA_PRE4HR_RETRY_DELAY_MINUTES: '0,0',
  WA_MEET_RETRY_DELAY_MINUTES: '0,0',
  WA_30MIN_RETRY_DELAY_MINUTES: '0',
  WA_CAMPAIGN_INFLIGHT_STALE_MS: '500',
  WA_SLOT_BOOKED_INFLIGHT_STALE_MS: '500',
  WA_REMINDER_JOB_OVERDUE_SLA_MS: '60000',
  MSG91_AUTH_KEY: 'test',
  MSG91_TEMPLATE_ID: 'test'
};

let snapshot = null;

function applyIntegrationEnv(overrides = {}) {
  snapshot = { ...process.env };
  Object.assign(process.env, INTEGRATION_DEFAULTS, overrides);
}

function restoreEnv() {
  if (!snapshot) return;
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
  snapshot = null;
}

function clearCrashPoint() {
  delete process.env.WA_TEST_CRASH_POINT;
}

module.exports = {
  INTEGRATION_DEFAULTS,
  applyIntegrationEnv,
  restoreEnv,
  clearCrashPoint
};
