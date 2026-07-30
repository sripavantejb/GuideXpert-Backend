'use strict';

/**
 * D-6 — which commercial service a booking link points at is a CODE decision.
 *
 * The LLM has NO input into this. `create_booking_link` never accepts a
 * serviceKey proposed by the model; it resolves one here from config, or from a
 * deterministic mapping of profile fields if multiple services are ever needed.
 *
 * TODO(decision D-6): which registry service is the V3 default — business call,
 * pending. Set FLOW_V3_DEFAULT_BOOKING_SERVICE to activate; until then
 * create_booking_link returns {needs:['serviceKey']} rather than guessing.
 */

const DEFAULT_BOOKING_SERVICE_ENV_VAR = 'FLOW_V3_DEFAULT_BOOKING_SERVICE';

/**
 * Deterministic profile → serviceKey mapping. Empty by design: a single
 * config-set default is the approved V3 shape. Entries added here must be pure
 * functions of stated (never inferred) profile fields.
 */
const PROFILE_SERVICE_RULES = Object.freeze([]);

function getConfiguredDefaultServiceKey(env = process.env) {
  const raw = env[DEFAULT_BOOKING_SERVICE_ENV_VAR];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length ? value : null;
}

/**
 * @param {object} profile
 * @param {{ env?: object }} [options]
 * @returns {{ serviceKey: string|null, source: string }}
 */
function resolveBookingServiceKey(profile = {}, options = {}) {
  const env = options.env || process.env;

  for (const rule of PROFILE_SERVICE_RULES) {
    const match = rule.match(profile);
    if (match) return { serviceKey: rule.serviceKey, source: 'profile_rule' };
  }

  const configured = getConfiguredDefaultServiceKey(env);
  if (configured) return { serviceKey: configured, source: 'config_default' };

  return { serviceKey: null, source: 'unresolved' };
}

module.exports = {
  DEFAULT_BOOKING_SERVICE_ENV_VAR,
  PROFILE_SERVICE_RULES,
  getConfiguredDefaultServiceKey,
  resolveBookingServiceKey,
};
