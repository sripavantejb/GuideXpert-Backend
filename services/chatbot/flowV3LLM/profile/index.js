'use strict';

/**
 * Flow V3 profile foundation — public surface.
 *
 * Two things live here:
 *
 * 1. A barrel over the M-1 modules (schema-aware merge, slot meta, legacy
 *    mirrors, authority/staleness, write policy, retention, phone hash, store).
 * 2. A compatibility adapter — `loadLeadProfile` / `ensureLeadProfile` /
 *    `casUpdateLeadProfile` / `buildReadViews` — for the tool + context layers
 *    that were written against those names.
 *
 * The adapter does not implement a second write path. `FlowV3LeadProfile`
 * versions on `__v` (the mongoose version key), so a CAS layer that compares a
 * separate `casVersion` field reads `undefined` on every turn and rejects every
 * write as a conflict. Everything below funnels into
 * `flowV3ProfileStore.applyProfilePatch`, which is the single write path:
 * validate → merge → slot meta → compare-and-swap on `__v`.
 */

const {
  LLM_WRITE_CHANNEL,
  SYSTEM_WRITE_CHANNEL,
} = require('../../../../constants/flowV3/flowV3ProfileEnums');

const store = require('./flowV3ProfileStore');
const derived = require('./flowV3ProfileDerived');
const slotMetaModule = require('./flowV3SlotMeta');
const mergeModule = require('./flowV3ProfileMerge');
const mirrorModule = require('./flowV3LegacyMirror');
const authorityModule = require('./flowV3ProfileAuthority');
const writePolicyModule = require('./flowV3ProfileWritePolicy');
const retentionModule = require('./flowV3RetentionPolicy');
const phoneHashModule = require('./flowV3PhoneHash');

/** Conversation pins are not part of the M-1 profile contract; only set what the model declares. */
const CONVERSATION_PIN_FIELDS = Object.freeze([
  'conversationGoal',
  'openThreads',
  'promisedNext',
  'lastAsk',
]);

function getModel() {
  return require('../../../../models/FlowV3LeadProfile');
}

/** `casVersion` is an alias of `__v` for callers written against the older name. */
function withCasVersion(doc) {
  if (!doc) return null;
  const version = doc.__v ?? 0;
  return { ...doc, casVersion: version, version };
}

function buildReadViews(profile = {}) {
  return {
    coreInterestBool: derived.deriveCoreInterest(profile),
    goalPriorityScalar: derived.getGoalPriorityScalar(profile),
    parentConstraintsList: derived.getParentConstraintsList(profile),
    collegeOfInterestList: derived.getCollegeOfInterestList(profile),
    primaryExamResult: mirrorModule.getPrimaryExamResult(profile),
  };
}

async function loadLeadProfile(phone10) {
  const doc = await store.loadProfileDoc(String(phone10));
  if (!doc) return null;
  return {
    ...withCasVersion(doc),
    profile: doc.profile || {},
    slotMeta: slotMetaModule.normalizeSlotMetaStore(doc.slotMeta),
    readViews: buildReadViews(doc.profile || {}),
  };
}

/**
 * Create-if-missing. A seed is treated as a system-owned write, so it goes
 * through the same CAS path rather than a raw create.
 */
async function ensureLeadProfile(phone10, seed = {}) {
  const phone = String(phone10);
  const doc = await store.ensureProfileDoc(phone);

  const seedProfile = seed && seed.profile;
  const hasSeedProfile = seedProfile && Object.keys(seedProfile).length > 0;
  const hasSeedYear = seed && seed.academicYear != null;
  if (!hasSeedProfile && !hasSeedYear) return withCasVersion(doc);

  await store.withCas(phone, (current, now) => {
    const set = {};
    if (hasSeedProfile) {
      set.profile = mergeModule.mergeFlowV3Profile(current.profile || {}, seedProfile, { now }).profile;
    }
    if (hasSeedYear) set.academicYear = seed.academicYear;
    return { set };
  });

  return withCasVersion(await store.loadProfileDoc(phone));
}

function resolveChannel({ channel, enforceLlmAllowlist }) {
  if (channel) return channel;
  return enforceLlmAllowlist ? LLM_WRITE_CHANNEL : SYSTEM_WRITE_CHANNEL;
}

function supportedPinPaths() {
  const schemaPaths = getModel().schema.paths;
  return CONVERSATION_PIN_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(schemaPaths, field));
}

/**
 * Version-checked profile write.
 *
 * `expectedVersion` is the `__v` the caller read for this turn. A mismatch is
 * reported as `cas_conflict` with the fresh document so the caller can re-read
 * and decide, rather than silently overwriting a concurrent turn's slots.
 *
 * @returns {Promise<{ ok: true, doc, applied, rejected, dropped, warnings, mirrored }
 *   | { ok: false, reason: 'not_found' | 'cas_conflict', doc?: object|null }>}
 */
async function casUpdateLeadProfile({
  phone,
  expectedVersion,
  profilePatch = {},
  metaByPath = {},
  enforceLlmAllowlist = false,
  channel = null,
  turnId = null,
  academicYear = null,
  conversationPins = null,
  now = null,
} = {}) {
  const phone10 = String(phone || '');
  const current = await store.loadProfileDoc(phone10);
  if (!current) return { ok: false, reason: 'not_found', doc: null };

  if (expectedVersion != null && Number(current.__v ?? 0) !== Number(expectedVersion)) {
    return { ok: false, reason: 'cas_conflict', doc: withCasVersion(current) };
  }

  let outcome;
  try {
    outcome = await store.applyProfilePatch({
      phone: phone10,
      patch: profilePatch,
      meta: metaByPath,
      channel: resolveChannel({ channel, enforceLlmAllowlist }),
      turnId,
      now,
      // The caller already pinned a version for this turn: retrying against a
      // newer document here would defeat its own conflict handling.
      maxAttempts: 1,
    });
  } catch (err) {
    if (err && err.code === 'FLOW_V3_PROFILE_CAS_CONFLICT') {
      return { ok: false, reason: 'cas_conflict', doc: withCasVersion(await store.loadProfileDoc(phone10)) };
    }
    throw err;
  }

  const applied = outcome.applied || [];
  const rejected = outcome.rejected || [];
  // A patch where every key was rejected OR dropped is a denied write, not a
  // successful one: reporting ok=true would let the caller claim a save that
  // never happened. Unknown keys land in `dropped` (schema mismatch), blocked
  // keys land in `rejected` — either alone is enough to deny.
  if (!applied.length && (rejected.length || (outcome.dropped || []).length || (outcome.droppedByMerge || []).length)) {
    return {
      ok: false,
      reason: 'write_denied',
      doc: withCasVersion(await store.loadProfileDoc(phone10)),
      applied,
      rejected,
      dropped: [...(outcome.dropped || []), ...(outcome.droppedByMerge || [])],
      warnings: outcome.warnings || [],
      mirrored: {},
    };
  }

  const warnings = [...(outcome.warnings || [])];
  const extraSet = {};
  if (academicYear != null) extraSet.academicYear = academicYear;
  if (conversationPins && typeof conversationPins === 'object') {
    const supported = supportedPinPaths();
    for (const field of CONVERSATION_PIN_FIELDS) {
      if (conversationPins[field] === undefined) continue;
      if (supported.includes(field)) extraSet[field] = conversationPins[field];
      else warnings.push({ field, reason: 'not_in_profile_schema' });
    }
  }
  if (Object.keys(extraSet).length) {
    await store.withCas(phone10, () => ({ set: extraSet }), { now });
  }

  return {
    ok: true,
    doc: withCasVersion(await store.loadProfileDoc(phone10)),
    applied,
    rejected,
    dropped: [...(outcome.dropped || []), ...(outcome.droppedByMerge || [])],
    warnings,
    mirrored: outcome.mirrored || {},
  };
}

/** Idle-survival guard: the durable profile must never carry a TTL index (§5.1). */
function profileCollectionHasTtlIndex(model = getModel()) {
  return model.schema.indexes().some(([, opts]) => opts && opts.expireAfterSeconds != null);
}

module.exports = {
  loadLeadProfile,
  ensureLeadProfile,
  casUpdateLeadProfile,
  buildReadViews,
  profileCollectionHasTtlIndex,

  ...store,
  ...slotMetaModule,
  ...mergeModule,
  ...mirrorModule,
  ...derived,
  ...authorityModule,
  ...writePolicyModule,
  ...retentionModule,
  ...phoneHashModule,
};
