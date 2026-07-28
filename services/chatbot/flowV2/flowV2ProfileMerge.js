'use strict';

/**
 * Flow v2 — profile merge logic.
 *
 * The generic `mergeContext()` in `services/chatbot/botStateService.js`
 * only special-cases two keys (`rank` deep-merge, `predictionIdempotency`/
 * `college` atomic-replace) and shallow-replaces everything else. Flow v2's
 * profile shape needs its own explicit, tested merge rules rather than
 * relying on that generic shallow merge, so this module is deliberately
 * standalone and does not call into `botStateService.js`.
 *
 * Rules:
 *  - Additive only: a patch value of `null`/`undefined` never clobbers an
 *    existing populated value — the key is simply skipped.
 *  - Scalars (string/number/boolean): patch value overwrites existing.
 *  - Arrays: existing + incoming are concatenated then deduplicated
 *    (`doorHistory` is the one exception — always appended, never
 *    deduplicated, since it's an append-only analytics trail).
 *  - Objects: shallow-merged (`{ ...existing, ...patch }`) when both sides
 *    are objects, otherwise the patch value replaces.
 *  - Keys not present in `LEAD_PROFILE_SCHEMA` are ignored — the schema is
 *    the contract for what this profile may contain.
 */

const { LEAD_PROFILE_SCHEMA } = require('../../../constants/careerCounsellingFlowV2Profile');

/**
 * Stable dedupe key for an array item. Primitives dedupe by value; objects
 * prefer an `id`/`collegeName`/`college_name` field if present, falling
 * back to a JSON.stringify of the object.
 */
function stableKey(item) {
  if (item === null || item === undefined) return String(item);
  if (typeof item !== 'object') return `${typeof item}:${String(item)}`;
  if (item.id != null) return `id:${item.id}`;
  if (item.collegeName) return `name:${item.collegeName}`;
  if (item.college_name) return `name:${item.college_name}`;
  try {
    return `json:${JSON.stringify(item)}`;
  } catch {
    return `raw:${String(item)}`;
  }
}

function dedupeArray(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = stableKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/**
 * @param {object} existingProfile
 * @param {object} patch - typically the output of flowV2SlotExtractor.extractFlowV2Slots
 * @returns {object} new merged profile (does not mutate inputs)
 */
function mergeFlowV2Profile(existingProfile = {}, patch = {}) {
  const base = { ...(existingProfile || {}) };

  for (const [key, rawValue] of Object.entries(patch || {})) {
    if (!(key in LEAD_PROFILE_SCHEMA)) continue; // unknown keys are ignored — schema is the contract
    if (rawValue === null || rawValue === undefined) continue; // additive-only: never clobber with empty

    const slotDef = LEAD_PROFILE_SCHEMA[key];
    const existingValue = base[key];

    if (key === 'doorHistory') {
      base[key] = [...asArray(existingValue), ...asArray(rawValue)];
      continue;
    }

    if (slotDef.type === 'array') {
      base[key] = dedupeArray([...asArray(existingValue), ...asArray(rawValue)]);
      continue;
    }

    if (slotDef.type === 'object') {
      const existingIsObject = existingValue && typeof existingValue === 'object';
      const patchIsObject = rawValue && typeof rawValue === 'object';
      base[key] = existingIsObject && patchIsObject ? { ...existingValue, ...rawValue } : rawValue;
      continue;
    }

    // scalars: string, number, boolean
    base[key] = rawValue;
  }

  return base;
}

module.exports = {
  mergeFlowV2Profile,
  dedupeArray,
  stableKey,
};
