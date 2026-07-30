'use strict';

/**
 * Flow V3 — sensitivity tiers, retention and access (LEAD_PROFILE_CONTRACT.md §3).
 *
 * METADATA AND PURE HELPERS ONLY. This module declares policy; it does not
 * enforce it. There is deliberately:
 *   - no scheduler / cron / job,
 *   - no Mongo TTL index anywhere on the V3 collections,
 *   - no delete or update path.
 * A TTL index is what destroyed all 75 slots in Flow V2 (G-2). Retention here is
 * an explicit, reviewable operation that some future job may run against these
 * plans — never a silent background sweep.
 *
 * Most of this profile describes a minor. §3 marks the DPDP children's-data
 * position as OPEN, so these policies are a defensible default, not a
 * compliance opinion. TODO(decision): legal review before Phase 2.
 */

const {
  TIER1_FIELDS,
  TIER2_FIELDS,
  TIER3_FIELDS,
  TIER4_FIELDS,
  TIER3_NESTED_PATHS,
  TIER4_NESTED_PATHS,
  CRISIS_RECORD_FIELDS,
} = require('./flowV3LeadProfileSchema');

const RETENTION_MODES = Object.freeze({
  INDEFINITE: 'indefinite',
  ANONYMIZE_AFTER: 'anonymize_after',
  PURPOSE_BOUND: 'purpose_bound',
  DELETE_AFTER: 'delete_after',
  EXISTING_CRISIS_POLICY: 'existing_crisis_handoff_policy',
});

const MONTHS_TO_MS = 30 * 24 * 60 * 60 * 1000;

const SENSITIVITY_TIERS = Object.freeze({
  1: Object.freeze({
    tier: 1,
    label: 'FUNNEL',
    retention: Object.freeze({ mode: RETENTION_MODES.INDEFINITE }),
    access: Object.freeze(['bot', 'counsellor', 'analytics_aggregate']),
    inLlmPrompt: true,
  }),
  2: Object.freeze({
    tier: 2,
    label: 'IDENTITY',
    retention: Object.freeze({
      mode: RETENTION_MODES.ANONYMIZE_AFTER,
      months: 24,
      from: 'lastSeenAt',
    }),
    access: Object.freeze(['bot', 'assigned_counsellor', 'admin']),
    inAggregateExports: false,
    inLlmPrompt: true,
  }),
  3: Object.freeze({
    tier: 3,
    label: 'PROTECTED',
    retention: Object.freeze({
      mode: RETENTION_MODES.PURPOSE_BOUND,
      purposes: Object.freeze(['cutoff_computation', 's1_demographic_gate']),
    }),
    access: Object.freeze(['predictor_tool', 'assigned_counsellor']),
    neverInferred: true,
    neverForSegmentation: true,
    /** Only when the predictor needs it for the current turn (§5). */
    inLlmPrompt: 'predictor_only',
  }),
  4: Object.freeze({
    tier: 4,
    label: 'VOLUNTEERED',
    retention: Object.freeze({
      mode: RETENTION_MODES.DELETE_AFTER,
      months: 6,
      from: 'lastSeenAt',
      /** Crisis records follow the existing handoff policy, not this clock. */
      exception: RETENTION_MODES.EXISTING_CRISIS_POLICY,
    }),
    access: Object.freeze(['assigned_counsellor']),
    inAggregateExports: false,
    neverAsked: true,
    inLlmPrompt: false,
  }),
});

const TIER_FIELDS = Object.freeze({
  1: TIER1_FIELDS,
  2: TIER2_FIELDS,
  3: TIER3_FIELDS,
  4: TIER4_FIELDS,
});

const TIER_NESTED_PATHS = Object.freeze({
  1: Object.freeze([]),
  2: Object.freeze([]),
  3: TIER3_NESTED_PATHS,
  4: TIER4_NESTED_PATHS,
});

/**
 * Tier-2 anonymisation actions (§3): hash the phone, drop name/school. The drop
 * list is the DIRECT IDENTIFIER set only — remaining Tier-2 fields (city, marks,
 * budget, family stance) are non-identifying context once the identifiers are
 * gone, and dropping them would destroy the funnel history the tier exists to
 * keep.
 */
const ANONYMIZATION_HASH_FIELDS = Object.freeze(['phone']);
const ANONYMIZATION_DROP_FIELDS = Object.freeze([
  'name',
  'preferredName',
  'schoolName',
  'altContact',
  'callbackNumber',
  'coachingInstitute',
]);

/** Fields exempt from the Tier-4 6-month purge — existing crisis policy owns them. */
const CRISIS_EXEMPT_FIELDS = CRISIS_RECORD_FIELDS;

/** Purpose-bound Tier-3 access: any other purpose is a policy violation. */
const TIER3_ALLOWED_PURPOSES = SENSITIVITY_TIERS[3].retention.purposes;

/** §3 — no TTL index is permitted on either V3 collection. */
const TTL_INDEXES_FORBIDDEN = true;

function monthsToMs(months) {
  return months * MONTHS_TO_MS;
}

function getTierPolicy(tier) {
  return SENSITIVITY_TIERS[tier] || null;
}

module.exports = {
  RETENTION_MODES,
  SENSITIVITY_TIERS,
  TIER_FIELDS,
  TIER_NESTED_PATHS,
  ANONYMIZATION_HASH_FIELDS,
  ANONYMIZATION_DROP_FIELDS,
  CRISIS_EXEMPT_FIELDS,
  TIER3_ALLOWED_PURPOSES,
  TTL_INDEXES_FORBIDDEN,
  MONTHS_TO_MS,
  monthsToMs,
  getTierPolicy,
};
