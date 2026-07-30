'use strict';

/**
 * Flow V3 — slot meta writer/reader (LEAD_PROFILE_CONTRACT.md §2, RULE A).
 *
 * Every profile field carries meta recording HOW the value was captured. This
 * module is the only place that builds or mutates those entries, so the two
 * mandatory-ness rules cannot be forgotten at a call site:
 *
 *   confidence     REQUIRED when source='inferred'
 *   verbatimQuote  REQUIRED when source ∈ typed | extracted | inferred
 *
 * History is append-only. A superseded entry is archived with `supersededBy` set
 * to the turn that corrected it, so a bad extraction stays diagnosable after the
 * fact instead of being overwritten out of existence.
 */

const {
  isKnownField,
  isStructuredArrayField,
  getStructuredArraySpec,
  isVolatileField,
  isNeverInferredField,
  NEVER_INFERRED_NESTED_PATHS,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const {
  SLOT_META_FIELDS,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
  deriveAcademicYear,
  encodeSlotMetaKey,
  decodeSlotMetaKey,
  isConfidenceRequired,
  isVerbatimRequired,
  isKnownSource,
} = require('../../../../constants/flowV3/flowV3SlotMetaContract');

const { isAuthoritativeSource, isNonAuthoritativeSource } = require('../../../../constants/flowV3/flowV3ProfileEnums');

const SLOT_META_ERRORS = Object.freeze({
  UNKNOWN_FIELD: 'SLOT_META_UNKNOWN_FIELD',
  UNKNOWN_SOURCE: 'SLOT_META_UNKNOWN_SOURCE',
  CONFIDENCE_REQUIRED: 'SLOT_META_CONFIDENCE_REQUIRED',
  CONFIDENCE_OUT_OF_RANGE: 'SLOT_META_CONFIDENCE_OUT_OF_RANGE',
  VERBATIM_REQUIRED: 'SLOT_META_VERBATIM_REQUIRED',
  INFERENCE_FORBIDDEN: 'SLOT_META_INFERENCE_FORBIDDEN',
  TURN_ID_REQUIRED: 'SLOT_META_TURN_ID_REQUIRED',
});

/** `examResults.0.rank` → { root: 'examResults', index: 0, leaf: 'rank' }. */
function parseFieldPath(fieldPath) {
  const segments = String(fieldPath).split('.');
  const root = segments[0];
  if (segments.length === 1) return { root, index: null, leaf: null, segments };
  const maybeIndex = Number(segments[1]);
  const hasIndex = Number.isInteger(maybeIndex);
  return {
    root,
    index: hasIndex ? maybeIndex : null,
    leaf: segments[segments.length - 1],
    segments,
  };
}

function isKnownFieldPath(fieldPath) {
  const { root, leaf } = parseFieldPath(fieldPath);
  if (!isKnownField(root)) return false;
  if (!leaf) return true;
  if (!isStructuredArrayField(root)) return false;
  const spec = getStructuredArraySpec(root);
  return Boolean(spec && spec.fields && Object.prototype.hasOwnProperty.call(spec.fields, leaf));
}

/** Never-inferred applies to the field and to Tier-3 entry fields (§1.C). */
function isInferenceForbiddenPath(fieldPath) {
  const { root, leaf } = parseFieldPath(fieldPath);
  if (isNeverInferredField(root)) return true;
  if (leaf && NEVER_INFERRED_NESTED_PATHS.includes(`${root}.${leaf}`)) return true;
  return false;
}

function isVolatilePath(fieldPath) {
  const { root, leaf } = parseFieldPath(fieldPath);
  if (isVolatileField(root)) return true;
  if (!leaf || !isStructuredArrayField(root)) return false;
  const spec = getStructuredArraySpec(root);
  const itemDef = spec && spec.fields ? spec.fields[leaf] : null;
  return Boolean(itemDef && itemDef.stale === 'V');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
function validateSlotMetaEntry(fieldPath, entry = {}) {
  const errors = [];
  const push = (code, message) => errors.push({ code, message });

  if (!isKnownFieldPath(fieldPath)) {
    push(SLOT_META_ERRORS.UNKNOWN_FIELD, `unknown profile field path: ${fieldPath}`);
  }

  const { source, confidence, verbatimQuote, turnId } = entry || {};

  if (!isKnownSource(source)) {
    push(SLOT_META_ERRORS.UNKNOWN_SOURCE, `source must be one of the six contract sources, got ${String(source)}`);
  }

  if (isConfidenceRequired(source)) {
    if (confidence === null || confidence === undefined) {
      push(SLOT_META_ERRORS.CONFIDENCE_REQUIRED, `confidence is required when source='${source}'`);
    } else if (
      typeof confidence !== 'number' ||
      Number.isNaN(confidence) ||
      confidence < MIN_CONFIDENCE ||
      confidence > MAX_CONFIDENCE
    ) {
      push(
        SLOT_META_ERRORS.CONFIDENCE_OUT_OF_RANGE,
        `confidence must be a number in [${MIN_CONFIDENCE}, ${MAX_CONFIDENCE}]`
      );
    }
  }

  if (isVerbatimRequired(source) && !nonEmptyString(verbatimQuote)) {
    push(SLOT_META_ERRORS.VERBATIM_REQUIRED, `verbatimQuote is required when source='${source}'`);
  }

  if (isNonAuthoritativeSource(source) && isInferenceForbiddenPath(fieldPath)) {
    push(
      SLOT_META_ERRORS.INFERENCE_FORBIDDEN,
      `${fieldPath} is authoritative-only and may never be inferred`
    );
  }

  if (!nonEmptyString(turnId)) {
    push(SLOT_META_ERRORS.TURN_ID_REQUIRED, 'turnId is required on every slot meta entry');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a meta entry. `academicYear` is attached for volatile paths only (§2) —
 * that is what makes a stale rank detectable a year later.
 */
function buildSlotMetaEntry(fieldPath, input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const setAt = input.setAt instanceof Date ? input.setAt : now;
  const entry = {
    source: input.source,
    confidence: input.confidence === undefined ? null : input.confidence,
    verbatimQuote: input.verbatimQuote === undefined ? null : input.verbatimQuote,
    setAt,
    turnId: input.turnId != null ? input.turnId : options.turnId,
    academicYear: null,
    supersededBy: null,
    history: [],
  };

  if (isVolatilePath(fieldPath)) {
    entry.academicYear =
      input.academicYear != null ? input.academicYear : deriveAcademicYear(setAt);
  }

  return entry;
}

/** Accepts a Mongoose Map, a plain stored object with escaped keys, or null. */
function normalizeSlotMetaStore(raw) {
  const out = {};
  if (!raw) return out;
  const entries =
    typeof raw.entries === 'function' && !Array.isArray(raw) ? [...raw.entries()] : Object.entries(raw);
  for (const [storedKey, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    out[decodeSlotMetaKey(storedKey)] = value;
  }
  return out;
}

/** Inverse of normalizeSlotMetaStore — dots escaped for safe Map/document keys. */
function serializeSlotMetaStore(store = {}) {
  const out = {};
  for (const [fieldPath, entry] of Object.entries(store || {})) {
    out[encodeSlotMetaKey(fieldPath)] = entry;
  }
  return out;
}

function getSlotMeta(store, fieldPath) {
  const normalized = normalizeSlotMetaStore(store);
  return normalized[fieldPath] || null;
}

function readValueAtPath(profile, fieldPath) {
  if (!profile) return undefined;
  const { segments } = parseFieldPath(fieldPath);
  let cursor = profile;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    const key = Array.isArray(cursor) ? Number(segment) : segment;
    cursor = cursor[key];
  }
  return cursor;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function archiveEntry(previousEntry, previousValue, supersededByTurnId) {
  return {
    value: previousValue === undefined ? null : previousValue,
    source: previousEntry.source ?? null,
    confidence: previousEntry.confidence ?? null,
    verbatimQuote: previousEntry.verbatimQuote ?? null,
    setAt: previousEntry.setAt ?? null,
    turnId: previousEntry.turnId ?? null,
    academicYear: previousEntry.academicYear ?? null,
    supersededBy: supersededByTurnId ?? null,
  };
}

/**
 * Apply meta updates for the paths a patch touched.
 *
 * Rejected updates are NOT applied — an invalid meta entry means the capture
 * claim itself is malformed, and storing a value whose provenance is unknown is
 * how stated and inferred stop being distinguishable (RULE A).
 *
 * @param {object} existingSlotMeta stored/serialized or already-normalized store
 * @param {object} metaUpdates      { fieldPath: { source, confidence, verbatimQuote, ... } }
 * @param {{ turnId: string, now?: Date, profileBefore?: object, profileAfter?: object }} options
 * @returns {{ slotMeta: object, applied: string[], rejected: Array<{ field, code, message }> }}
 */
function applySlotMetaUpdates(existingSlotMeta, metaUpdates = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const slotMeta = normalizeSlotMetaStore(existingSlotMeta);
  const applied = [];
  const rejected = [];

  for (const [fieldPath, rawEntry] of Object.entries(metaUpdates || {})) {
    const candidate = { ...(rawEntry || {}) };
    if (candidate.turnId == null) candidate.turnId = options.turnId;

    const { valid, errors } = validateSlotMetaEntry(fieldPath, candidate);
    if (!valid) {
      for (const error of errors) {
        rejected.push({ field: fieldPath, code: error.code, message: error.message });
      }
      continue;
    }

    const nextEntry = buildSlotMetaEntry(fieldPath, candidate, { now, turnId: options.turnId });
    const previousEntry = slotMeta[fieldPath];

    if (previousEntry) {
      const previousValue = readValueAtPath(options.profileBefore, fieldPath);
      const nextValue = readValueAtPath(options.profileAfter, fieldPath);
      const idempotentRewrite =
        sameValue(previousValue, nextValue) &&
        previousEntry.source === nextEntry.source &&
        (previousEntry.verbatimQuote ?? null) === (nextEntry.verbatimQuote ?? null);

      const history = Array.isArray(previousEntry.history) ? [...previousEntry.history] : [];
      if (!idempotentRewrite) {
        history.push(archiveEntry(previousEntry, previousValue, nextEntry.turnId));
      }
      nextEntry.history = history;
    }

    slotMeta[fieldPath] = nextEntry;
    applied.push(fieldPath);
  }

  return { slotMeta, applied, rejected };
}

function listPathsBySource(store, predicate) {
  const normalized = normalizeSlotMetaStore(store);
  return Object.keys(normalized).filter((fieldPath) => predicate(normalized[fieldPath].source));
}

function listInferredPaths(store) {
  return listPathsBySource(store, isNonAuthoritativeSource);
}

function listAuthoritativePaths(store) {
  return listPathsBySource(store, isAuthoritativeSource);
}

module.exports = {
  SLOT_META_ERRORS,
  SLOT_META_FIELDS,
  parseFieldPath,
  isKnownFieldPath,
  isInferenceForbiddenPath,
  isVolatilePath,
  validateSlotMetaEntry,
  buildSlotMetaEntry,
  normalizeSlotMetaStore,
  serializeSlotMetaStore,
  getSlotMeta,
  readValueAtPath,
  applySlotMetaUpdates,
  listInferredPaths,
  listAuthoritativePaths,
};
