'use strict';

/**
 * Turn-log phone field policy.
 *
 * Canonical pepper env var: FLOW_V3_PHONE_HASH_PEPPER (the only accepted name).
 *
 * Missing pepper is a config failure, not a student-facing failure:
 *   - never log or store an unhashed phone,
 *   - omit the phone field entirely (phoneHash: null),
 *   - emit an ERROR so it is visible in logs and alerting,
 *   - do NOT throw and do NOT exit — a missing log-field secret must not take
 *     the bot down for students mid-conversation.
 */

const {
  hashPhone,
  isPepperConfigured,
  PHONE_HASH_PEPPER_ENV_VAR,
  PHONE_HASH_ERRORS,
} = require('../profile/flowV3PhoneHash');

let pepperErrorLogged = false;

function logPepperMissingOnce(context = {}) {
  if (pepperErrorLogged) return;
  pepperErrorLogged = true;
  console.error(
    '[flowV3] ERROR phone_hash_pepper_missing',
    JSON.stringify({
      event: 'flow_v3_phone_hash_pepper_missing',
      env_var: PHONE_HASH_PEPPER_ENV_VAR,
      impact: 'turn logs are written WITHOUT a phone field; per-student replay/joins unavailable',
      action: `set ${PHONE_HASH_PEPPER_ENV_VAR} in this environment`,
      severity: 'error',
      ...context,
    })
  );
}

/** Reset for tests only. */
function _resetPepperErrorLatch() {
  pepperErrorLogged = false;
}

/**
 * @param {string} phone10
 * @returns {{ phoneHash: string|null, omitted: boolean, reason: string|null }}
 */
function resolveTurnLogPhoneHash(phone10, options = {}) {
  const result = hashPhone(phone10, options);
  if (result.ok) return { phoneHash: result.hash, omitted: false, reason: null };

  if (result.error.code === PHONE_HASH_ERRORS.PEPPER_MISSING) {
    logPepperMissingOnce({ conversationId: options.conversationId || null });
    return { phoneHash: null, omitted: true, reason: PHONE_HASH_ERRORS.PEPPER_MISSING };
  }

  // Invalid phone: also omit. Never fall back to a raw value.
  console.error(
    '[flowV3] ERROR phone_hash_invalid_input',
    JSON.stringify({ event: 'flow_v3_phone_hash_invalid_input', code: result.error.code })
  );
  return { phoneHash: null, omitted: true, reason: result.error.code };
}

/**
 * Startup health check — alerts loudly, never exits.
 * @returns {{ healthy: boolean, checks: Array<{name:string,ok:boolean,detail:string}> }}
 */
function checkFlowV3LogHealth(env = process.env) {
  const pepperOk = isPepperConfigured({ pepper: env[PHONE_HASH_PEPPER_ENV_VAR] });
  const checks = [
    {
      name: 'phone_hash_pepper',
      ok: pepperOk,
      detail: pepperOk
        ? `${PHONE_HASH_PEPPER_ENV_VAR} is set`
        : `${PHONE_HASH_PEPPER_ENV_VAR} is NOT set — turn logs will omit the phone field`,
    },
  ];

  const healthy = checks.every((c) => c.ok);
  if (!healthy) {
    for (const check of checks.filter((c) => !c.ok)) {
      console.error(
        '[flowV3] ERROR startup_health_check_failed',
        JSON.stringify({
          event: 'flow_v3_startup_health_check_failed',
          check: check.name,
          detail: check.detail,
          fatal: false,
        })
      );
    }
  }
  return { healthy, checks };
}

module.exports = {
  resolveTurnLogPhoneHash,
  checkFlowV3LogHealth,
  logPepperMissingOnce,
  _resetPepperErrorLatch,
};
