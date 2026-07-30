'use strict';

/**
 * Flow V3 staleness — schema tag is the single source of truth.
 *
 * `stale:'V'` on flowV3LeadProfileSchema drives both the 7-day age-out and the
 * academic-year mismatch check. A second hand-maintained volatile list was
 * deleted in R-2b because it drifted (11 names not in the schema, 15 schema-V
 * names never aged out).
 */

const {
  VOLATILE_FIELDS,
  VOLATILE_STALE_MS,
  isVolatileField,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');
const { isNonAuthoritativeSource } = require('../../../../constants/flowV3/flowV3ProfileEnums');

function isVolatileSlot(path) {
  const top = String(path || '').split('.')[0];
  return isVolatileField(top) || VOLATILE_FIELDS.includes(top);
}

/**
 * @param {object|null} meta
 * @param {{ academicYear?: number|null, now?: Date, path?: string, forceVolatile?: boolean }} [opts]
 */
function isStale(meta, opts = {}) {
  if (!meta || typeof meta !== 'object') return false;
  const pathHint = opts.path || '';
  if (!isVolatileSlot(pathHint) && !opts.forceVolatile) return false;

  const now = opts.now || new Date();
  const setAt = meta.setAt ? new Date(meta.setAt).getTime() : NaN;
  if (Number.isFinite(setAt) && now.getTime() - setAt > VOLATILE_STALE_MS) return true;

  const profileYear = opts.academicYear;
  const metaYear = meta.academicYear;
  if (profileYear != null && metaYear != null && Number(profileYear) !== Number(metaYear)) {
    return true;
  }
  return false;
}

/**
 * Treat as empty for gating: missing, inferred-only, or stale-volatile.
 */
function isEmptyForV3Gating(value, meta, opts = {}) {
  if (value == null) return true;
  if (typeof value === 'string' && !value.trim()) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (meta && isNonAuthoritativeSource(meta.source)) return true;
  if (meta && isStale(meta, opts)) return true;
  return false;
}

module.exports = {
  isVolatileSlot,
  isStale,
  isEmptyForV3Gating,
  VOLATILE_STALE_MS,
  VOLATILE_FIELDS,
};
