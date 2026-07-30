'use strict';

/**
 * Flow V3 — retention helpers (LEAD_PROFILE_CONTRACT.md §3).
 *
 * PURE FUNCTIONS ONLY. Every function here reads and returns plans; none writes,
 * deletes, schedules or registers an index. That is deliberate:
 *
 *   - a Mongo TTL index is what silently destroyed all 75 slots in Flow V2 (G-2),
 *     and the whole point of the V3 collection is that it is never TTL-swept;
 *   - retention on a minor's profile should be an explicit, logged, reviewable
 *     operation, not a background sweep nobody watches.
 *
 * A future job may call `evaluateRetention()` and execute the returned plan. The
 * plan is data, so it can be asserted in tests and reviewed in a dry run.
 */

const {
  SENSITIVITY_TIERS,
  TIER_FIELDS,
  TIER_NESTED_PATHS,
  ANONYMIZATION_HASH_FIELDS,
  ANONYMIZATION_DROP_FIELDS,
  CRISIS_EXEMPT_FIELDS,
  TIER3_ALLOWED_PURPOSES,
  RETENTION_MODES,
  monthsToMs,
} = require('../../../../constants/flowV3/flowV3Retention');

const { getFieldTier, getFieldDef } = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const RETENTION_ACTIONS = Object.freeze({
  RETAIN: 'retain',
  ANONYMIZE: 'anonymize',
  PURGE: 'purge',
  PURPOSE_BOUND: 'purpose_bound',
  CRISIS_POLICY: 'defer_to_crisis_policy',
});

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `lastSeenAt` is the clock for both timed tiers (§3). It is a group-H field
 * written by the pipeline; `updatedAt` is the fallback for a document written
 * before engagement tracking existed.
 */
function resolveLastSeenAt(doc = {}) {
  const profile = doc.profile || {};
  return toDate(profile.lastSeenAt) || toDate(doc.updatedAt) || toDate(profile.createdAt) || null;
}

function getFieldRetention(field) {
  const tier = getFieldTier(field);
  const def = getFieldDef(field);
  if (!def) return null;
  if (def.crisisRecord === true) {
    return {
      field,
      tier,
      mode: RETENTION_MODES.EXISTING_CRISIS_POLICY,
      action: RETENTION_ACTIONS.CRISIS_POLICY,
    };
  }
  const policy = SENSITIVITY_TIERS[tier];
  if (!policy) return { field, tier, mode: null, action: RETENTION_ACTIONS.RETAIN };
  return { field, tier, mode: policy.retention.mode, action: actionForMode(policy.retention.mode) };
}

function actionForMode(mode) {
  switch (mode) {
    case RETENTION_MODES.INDEFINITE:
      return RETENTION_ACTIONS.RETAIN;
    case RETENTION_MODES.ANONYMIZE_AFTER:
      return RETENTION_ACTIONS.ANONYMIZE;
    case RETENTION_MODES.DELETE_AFTER:
      return RETENTION_ACTIONS.PURGE;
    case RETENTION_MODES.PURPOSE_BOUND:
      return RETENTION_ACTIONS.PURPOSE_BOUND;
    default:
      return RETENTION_ACTIONS.RETAIN;
  }
}

function listFieldsForTier(tier) {
  return TIER_FIELDS[tier] || [];
}

function dueAtFrom(lastSeenAt, months) {
  return lastSeenAt ? new Date(lastSeenAt.getTime() + monthsToMs(months)) : null;
}

/**
 * Tier 2 — 24 months from lastSeenAt, then anonymise: hash the phone, drop the
 * direct identifiers. Funnel history survives; the person becomes unidentifiable.
 */
function buildTier2AnonymizationPlan(doc = {}, options = {}) {
  const now = toDate(options.now) || new Date();
  const lastSeenAt = resolveLastSeenAt(doc);
  const policy = SENSITIVITY_TIERS[2];
  const dueAt = dueAtFrom(lastSeenAt, policy.retention.months);
  return {
    tier: 2,
    action: RETENTION_ACTIONS.ANONYMIZE,
    lastSeenAt,
    dueAt,
    due: Boolean(dueAt && now.getTime() >= dueAt.getTime()),
    hashFields: ANONYMIZATION_HASH_FIELDS,
    dropFields: ANONYMIZATION_DROP_FIELDS,
    /** The hash must be peppered — see flowV3PhoneHash. */
    requiresPepperedPhoneHash: true,
    retainedFields: listFieldsForTier(2).filter(
      (field) => !ANONYMIZATION_DROP_FIELDS.includes(field) && !ANONYMIZATION_HASH_FIELDS.includes(field)
    ),
  };
}

/**
 * Tier 4 — 6 months from lastSeenAt, EXCEPT crisis records, which follow the
 * existing handoff policy and are never purged on this clock.
 */
function buildTier4PurgePlan(doc = {}, options = {}) {
  const now = toDate(options.now) || new Date();
  const lastSeenAt = resolveLastSeenAt(doc);
  const policy = SENSITIVITY_TIERS[4];
  const dueAt = dueAtFrom(lastSeenAt, policy.retention.months);
  const allTier4 = listFieldsForTier(4);
  return {
    tier: 4,
    action: RETENTION_ACTIONS.PURGE,
    lastSeenAt,
    dueAt,
    due: Boolean(dueAt && now.getTime() >= dueAt.getTime()),
    purgeFields: allTier4.filter((field) => !CRISIS_EXEMPT_FIELDS.includes(field)),
    exemptFields: CRISIS_EXEMPT_FIELDS,
    exemptReason: RETENTION_MODES.EXISTING_CRISIS_POLICY,
    nestedPurgePaths: TIER_NESTED_PATHS[4] || [],
  };
}

/** Tier 3 is purpose-bound: cutoff computation and the S-1 gate, nothing else. */
function checkTier3Purpose(purpose) {
  const allowed = TIER3_ALLOWED_PURPOSES.includes(purpose);
  return {
    allowed,
    purpose,
    allowedPurposes: TIER3_ALLOWED_PURPOSES,
    reason: allowed ? null : 'TIER3_PURPOSE_NOT_ALLOWED',
  };
}

/**
 * Whole-document retention evaluation. Returns a plan per tier; the caller
 * decides whether to execute anything.
 */
function evaluateRetention(doc = {}, options = {}) {
  const now = toDate(options.now) || new Date();
  const lastSeenAt = resolveLastSeenAt(doc);
  return {
    evaluatedAt: now,
    lastSeenAt,
    tier1: {
      tier: 1,
      action: RETENTION_ACTIONS.RETAIN,
      mode: RETENTION_MODES.INDEFINITE,
      fields: listFieldsForTier(1),
    },
    tier2: buildTier2AnonymizationPlan(doc, { now }),
    tier3: {
      tier: 3,
      action: RETENTION_ACTIONS.PURPOSE_BOUND,
      mode: RETENTION_MODES.PURPOSE_BOUND,
      purposes: TIER3_ALLOWED_PURPOSES,
      fields: listFieldsForTier(3),
      nestedPaths: TIER_NESTED_PATHS[3] || [],
      neverInferred: true,
      neverForSegmentation: true,
    },
    tier4: buildTier4PurgePlan(doc, { now }),
    ttlIndexUsed: false,
    schedulerImplemented: false,
  };
}

/** Fields that may never enter an LLM prompt (§3 Tier 4, and §5's projection rule). */
function fieldsExcludedFromLlmPrompt() {
  return listFieldsForTier(4);
}

module.exports = {
  RETENTION_ACTIONS,
  RETENTION_MODES,
  SENSITIVITY_TIERS,
  resolveLastSeenAt,
  getFieldRetention,
  listFieldsForTier,
  buildTier2AnonymizationPlan,
  buildTier4PurgePlan,
  checkTier3Purpose,
  evaluateRetention,
  fieldsExcludedFromLlmPrompt,
};
