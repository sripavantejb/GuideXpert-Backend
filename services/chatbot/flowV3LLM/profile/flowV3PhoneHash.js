'use strict';

/**
 * Flow V3 — turn-log phone hashing (FLOW_V3_LLM_ARCHITECTURE §9.3).
 *
 * The turn log stores `phoneHash`, never a raw phone: it is an eval store that
 * gets exported, replayed and read by engineers, and a 10-digit Indian mobile
 * number is a direct identifier with a tiny keyspace.
 *
 *   phoneHash = sha256(phone + FLOW_V3_PHONE_HASH_PEPPER)
 *
 * FAIL CLOSED ON A MISSING PEPPER. An unpeppered sha256 of a 10-digit number is
 * brute-forceable in well under a second (10^10 candidates), so writing one
 * would be pseudonymisation in name only. When the pepper is absent this
 * returns a config error and produces NO hash; the caller decides what to do
 * with the turn log rather than silently persisting a reversible digest.
 *
 * TODO(decision): where the pepper lives in each environment, and whether a
 * missing pepper should fail the whole turn or only skip turn logging. Skipping
 * the log loses eval data; failing the turn loses a student's reply. Both are
 * bad in different ways, so it is a product decision, not an implementation one.
 */

const crypto = require('crypto');

const PHONE_HASH_PEPPER_ENV_VAR = 'FLOW_V3_PHONE_HASH_PEPPER';

const PHONE_HASH_ERRORS = Object.freeze({
  PEPPER_MISSING: 'FLOW_V3_PHONE_HASH_PEPPER_MISSING',
  INVALID_PHONE: 'FLOW_V3_PHONE_HASH_INVALID_PHONE',
});

const PHONE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const PHONE_PATTERN = /^\d{10}$/;

class FlowV3PhoneHashError extends Error {
  constructor({ code, message, todo = null }) {
    super(message);
    this.name = 'FlowV3PhoneHashError';
    this.code = code;
    this.todo = todo;
  }
}

/** Explicit `pepper` option wins so tests never depend on ambient env. */
function resolvePepper(options = {}) {
  const raw =
    options.pepper !== undefined && options.pepper !== null
      ? options.pepper
      : process.env[PHONE_HASH_PEPPER_ENV_VAR];
  const pepper = typeof raw === 'string' ? raw.trim() : '';
  return pepper.length ? pepper : null;
}

function normalizePhone(phone) {
  const value = typeof phone === 'number' ? String(phone) : phone;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return PHONE_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * @returns {{ ok: true, hash: string }} on success
 * @returns {{ ok: false, error: { code, message, todo } }} on a config or input error
 */
function hashPhone(phone, options = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: PHONE_HASH_ERRORS.INVALID_PHONE,
        message: 'phone must be a 10-digit string before hashing',
        todo: null,
      },
    };
  }

  const pepper = resolvePepper(options);
  if (!pepper) {
    return {
      ok: false,
      error: {
        code: PHONE_HASH_ERRORS.PEPPER_MISSING,
        message: `${PHONE_HASH_PEPPER_ENV_VAR} is not set — refusing to write an unpeppered phone hash`,
        todo: 'TODO(decision): pepper provisioning per environment + behaviour when absent',
      },
    };
  }

  return {
    ok: true,
    hash: crypto.createHash('sha256').update(`${normalized}${pepper}`).digest('hex'),
  };
}

function hashPhoneOrThrow(phone, options = {}) {
  const result = hashPhone(phone, options);
  if (!result.ok) throw new FlowV3PhoneHashError(result.error);
  return result.hash;
}

function isPhoneHash(value) {
  return typeof value === 'string' && PHONE_HASH_PATTERN.test(value);
}

function isPepperConfigured(options = {}) {
  return resolvePepper(options) !== null;
}

module.exports = {
  PHONE_HASH_PEPPER_ENV_VAR,
  PHONE_HASH_ERRORS,
  PHONE_HASH_PATTERN,
  FlowV3PhoneHashError,
  hashPhone,
  hashPhoneOrThrow,
  isPhoneHash,
  isPepperConfigured,
};
