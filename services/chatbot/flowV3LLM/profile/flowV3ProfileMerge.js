'use strict';

/**
 * Flow V3 — profile merge wrapper (LEAD_PROFILE_CONTRACT.md §5, ARCH §5.3).
 *
 * `flowV2ProfileMerge.js` is correct and frozen, so it is DELEGATED TO, not
 * forked: every flat legacy slot in a patch is merged by `mergeFlowV2Profile`
 * with its exact live semantics (unknown keys dropped, nulls never clobber,
 * arrays concat+dedupe, doorHistory append-only, objects shallow-merge, scalars
 * overwrite). This wrapper adds only what the frozen module cannot know about:
 *
 *   - V3-new scalar / date / array fields
 *   - the five structured arrays, merged by ENTRY IDENTITY rather than by
 *     JSON equality, so a status update to an existing objection is an update
 *     and not a second objection
 *   - append-only arrays (leadStageHistory)
 *   - monotonic guards that must not be bypassed by a patch: leadStage forward
 *     only, bookingStatus null → link_sent → done (S-4), crisisLocked never
 *     unset (S-2)
 *   - the one-directional legacy mirrors (§1.C, §1.G)
 *
 * Nothing here edits or re-implements the frozen module.
 */

const { mergeFlowV2Profile, dedupeArray, stableKey } = require('../../flowV2/flowV2ProfileMerge');
const { LEAD_PROFILE_SCHEMA } = require('../../../../constants/careerCounsellingFlowV2Profile');

const {
  FLOW_V3_PROFILE_SCHEMA,
  V3_NEW_FIELDS,
  STRUCTURED_ARRAY_SPECS,
  isKnownField,
  isStructuredArrayField,
  getStructuredArraySpec,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const { canAdvanceLeadStage, canAdvanceBookingStatus } = require('../../../../constants/flowV3/flowV3ProfileEnums');

const { applyLegacyMirrors } = require('./flowV3LegacyMirror');

const MERGE_DROP_REASONS = Object.freeze({
  UNKNOWN_FIELD: 'MERGE_UNKNOWN_FIELD',
  NULL_VALUE: 'MERGE_NULL_VALUE_SKIPPED',
  INVALID_DATE: 'MERGE_INVALID_DATE',
  INVALID_ENTRY: 'MERGE_INVALID_STRUCTURED_ENTRY',
  LEAD_STAGE_NOT_MONOTONIC: 'MERGE_LEAD_STAGE_NOT_MONOTONIC',
  BOOKING_STATUS_NOT_MONOTONIC: 'MERGE_BOOKING_STATUS_NOT_MONOTONIC',
  CRISIS_LOCK_PERMANENT: 'MERGE_CRISIS_LOCK_PERMANENT',
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function coerceDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function identityOf(entry, spec) {
  if (!spec || !Array.isArray(spec.identity) || !spec.identity.length) return null;
  const caseInsensitive = new Set(spec.caseInsensitiveIdentityFields || []);
  const parts = [];
  for (const field of spec.identity) {
    const value = entry[field];
    if (value === null || value === undefined || value === '') return null; // incomplete identity → cannot match
    parts.push(caseInsensitive.has(field) ? String(value).trim().toLowerCase() : String(value));
  }
  return parts.join('\u0000');
}

/** Additive per-field merge of one structured-array entry into another. */
function mergeEntry(existingEntry, patchEntry) {
  const next = { ...existingEntry };
  for (const [field, value] of Object.entries(patchEntry)) {
    if (value === null || value === undefined) continue;
    const existingValue = next[field];
    if (Array.isArray(value)) {
      next[field] = dedupeArray([...asArray(existingValue), ...value]);
      continue;
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      next[field] =
        existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
          ? { ...existingValue, ...value }
          : value;
      continue;
    }
    next[field] = value;
  }
  return next;
}

/**
 * Merge a structured array by entry identity.
 *
 * @returns {{ array: object[], warnings: Array<{ field, reason, detail? }>, touchedIndexes: number[] }}
 */
function mergeStructuredArray(field, existingValue, patchValue) {
  const spec = getStructuredArraySpec(field);
  const out = asArray(existingValue).map((entry) => ({ ...entry }));
  const warnings = [];
  const touchedIndexes = [];

  for (const rawEntry of asArray(patchValue)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      warnings.push({ field, reason: MERGE_DROP_REASONS.INVALID_ENTRY, detail: String(rawEntry) });
      continue;
    }
    if (spec && spec.appendOnly === true) {
      out.push({ ...rawEntry });
      touchedIndexes.push(out.length - 1);
      continue;
    }

    const patchIdentity = identityOf(rawEntry, spec);
    const matchIndex =
      patchIdentity === null
        ? -1
        : out.findIndex((entry) => identityOf(entry, spec) === patchIdentity);

    if (matchIndex >= 0) {
      out[matchIndex] = mergeEntry(out[matchIndex], rawEntry);
      touchedIndexes.push(matchIndex);
      continue;
    }

    // No identity match. Fall back to the frozen module's stableKey so a
    // byte-identical entry replayed by a retried inbound is not duplicated.
    const replayIndex = out.findIndex((entry) => stableKey(entry) === stableKey(rawEntry));
    if (replayIndex >= 0) {
      out[replayIndex] = mergeEntry(out[replayIndex], rawEntry);
      touchedIndexes.push(replayIndex);
      continue;
    }

    out.push({ ...rawEntry });
    touchedIndexes.push(out.length - 1);
  }

  return { array: out, warnings, touchedIndexes };
}

/**
 * §1.C — exactly one exam entry may be primary. A primary flag arriving in this
 * patch wins; otherwise an existing primary is kept; otherwise a lone entry is
 * treated as primary (see flowV3LegacyMirror).
 */
function normalizeExamPrimary(entries, patchTouchedIndexes) {
  const list = asArray(entries).map((entry) => ({ ...entry }));
  if (!list.length) return list;

  const touched = new Set(patchTouchedIndexes || []);
  let winner = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].isPrimary === true && touched.has(i)) winner = i;
  }
  if (winner < 0) winner = list.findIndex((entry) => entry.isPrimary === true);
  if (winner < 0 && list.length === 1) winner = 0;

  for (let i = 0; i < list.length; i += 1) {
    if (list[i].isPrimary === undefined && i !== winner) continue;
    list[i].isPrimary = i === winner;
  }
  return list;
}

/**
 * Guards applied to legacy keys BEFORE delegating to the frozen merge — the
 * frozen module has no notion of monotonicity, so a regressive value has to be
 * removed from the patch rather than un-written afterwards.
 */
function guardLegacyPatch(existingProfile, legacyPatch) {
  const guarded = { ...legacyPatch };
  const dropped = [];

  if ('crisisLocked' in guarded && existingProfile.crisisLocked === true && guarded.crisisLocked !== true) {
    dropped.push({ field: 'crisisLocked', reason: MERGE_DROP_REASONS.CRISIS_LOCK_PERMANENT });
    delete guarded.crisisLocked;
  }

  if (
    'bookingStatus' in guarded &&
    guarded.bookingStatus !== null &&
    guarded.bookingStatus !== undefined &&
    !canAdvanceBookingStatus(existingProfile.bookingStatus, guarded.bookingStatus)
  ) {
    dropped.push({
      field: 'bookingStatus',
      reason: MERGE_DROP_REASONS.BOOKING_STATUS_NOT_MONOTONIC,
      detail: `${String(existingProfile.bookingStatus)} → ${String(guarded.bookingStatus)}`,
    });
    delete guarded.bookingStatus;
  }

  return { guarded, dropped };
}

/**
 * @param {object} existingProfile
 * @param {object} patch
 * @param {{ mirrors?: boolean }} [options] set `mirrors: false` only for unit
 *        tests that assert pre-mirror state
 * @returns {{ profile, applied: string[], dropped: Array, mirrored: object, warnings: Array }}
 */
function mergeFlowV3Profile(existingProfile = {}, patch = {}, options = {}) {
  const base = { ...(existingProfile || {}) };
  const dropped = [];
  const warnings = [];
  const applied = [];

  const legacyPatch = {};
  const v3Patch = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in LEAD_PROFILE_SCHEMA) {
      legacyPatch[key] = value;
    } else if (key in V3_NEW_FIELDS) {
      v3Patch[key] = value;
    } else {
      dropped.push({ field: key, reason: MERGE_DROP_REASONS.UNKNOWN_FIELD });
    }
  }

  const { guarded, dropped: legacyDropped } = guardLegacyPatch(base, legacyPatch);
  dropped.push(...legacyDropped);

  let profile = mergeFlowV2Profile(base, guarded);
  for (const key of Object.keys(guarded)) {
    if (guarded[key] === null || guarded[key] === undefined) {
      dropped.push({ field: key, reason: MERGE_DROP_REASONS.NULL_VALUE });
      continue;
    }
    applied.push(key);
  }

  for (const [key, rawValue] of Object.entries(v3Patch)) {
    if (rawValue === null || rawValue === undefined) {
      dropped.push({ field: key, reason: MERGE_DROP_REASONS.NULL_VALUE });
      continue;
    }
    const def = FLOW_V3_PROFILE_SCHEMA[key];

    if (isStructuredArrayField(key)) {
      const merged = mergeStructuredArray(key, profile[key], rawValue);
      warnings.push(...merged.warnings);
      profile[key] =
        key === 'examResults'
          ? normalizeExamPrimary(merged.array, merged.touchedIndexes)
          : merged.array;
      applied.push(key);
      continue;
    }

    if (def.type === 'array') {
      profile[key] = def.appendOnly === true
        ? [...asArray(profile[key]), ...asArray(rawValue)]
        : dedupeArray([...asArray(profile[key]), ...asArray(rawValue)]);
      applied.push(key);
      continue;
    }

    if (def.type === 'date') {
      const date = coerceDate(rawValue);
      if (!date) {
        dropped.push({ field: key, reason: MERGE_DROP_REASONS.INVALID_DATE, detail: String(rawValue) });
        continue;
      }
      profile[key] = date;
      applied.push(key);
      continue;
    }

    if (def.type === 'object') {
      const existingValue = profile[key];
      const bothObjects =
        existingValue && typeof existingValue === 'object' && rawValue && typeof rawValue === 'object';
      profile[key] = bothObjects ? { ...existingValue, ...rawValue } : rawValue;
      applied.push(key);
      continue;
    }

    if (key === 'leadStage' && !canAdvanceLeadStage(profile.leadStage, rawValue)) {
      dropped.push({
        field: key,
        reason: MERGE_DROP_REASONS.LEAD_STAGE_NOT_MONOTONIC,
        detail: `${String(profile.leadStage)} → ${String(rawValue)}`,
      });
      continue;
    }

    profile[key] = rawValue;
    applied.push(key);
  }

  if (options.mirrors === false) {
    return { profile, applied, dropped, mirrored: {}, warnings };
  }

  const mirrorResult = applyLegacyMirrors(profile);
  warnings.push(
    ...mirrorResult.warnings.map((reason) => ({ field: 'examResults', reason }))
  );
  return {
    profile: mirrorResult.profile,
    applied,
    dropped,
    mirrored: mirrorResult.mirrored,
    warnings,
  };
}

module.exports = {
  MERGE_DROP_REASONS,
  STRUCTURED_ARRAY_SPECS,
  mergeFlowV3Profile,
  mergeStructuredArray,
  normalizeExamPrimary,
  guardLegacyPatch,
  coerceDate,
  isKnownField,
};
