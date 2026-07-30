'use strict';

/**
 * Flow V3 — RULE A enforcement: stated and inferred are never the same field.
 *
 * An inferred slot MAY shape how the bot phrases things. It may NOT:
 *   ✗ satisfy nextSlot() — it still counts as EMPTY and gets asked
 *   ✗ gate a recommendation or filter a shortlist
 *   ✗ feed the predictor
 *   ✗ be shown to a counsellor as fact
 *
 * Staleness (§5.2) is the second reason a filled slot still counts as empty: a
 * student returning nine months later has last year's rank, and silently reusing
 * it produces a rank list that is confidently wrong. Re-asking a rank is cheaper
 * than a wrong prediction.
 *
 * These are the helpers every consumer must go through. A caller that reads
 * `profile.rank` directly gets no authority or staleness check, which is exactly
 * the failure mode S-1 exists to prevent.
 */

const {
  isNonAuthoritativeField,
  isVolatileField,
  isSoftField,
  getFieldDef,
  SOFT_STALENESS_DAYS,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const { isAuthoritativeSource, isNonAuthoritativeSource } = require('../../../../constants/flowV3/flowV3ProfileEnums');
const { deriveAcademicYear } = require('../../../../constants/flowV3/flowV3SlotMetaContract');
const { isEmptyForGating } = require('../../flowV2/nextSlot');
const { normalizeSlotMetaStore, parseFieldPath, readValueAtPath } = require('./flowV3SlotMeta');

const EMPTY_REASONS = Object.freeze({
  UNSET: 'unset',
  STALE_VOLATILE: 'stale_volatile',
  INFERRED_ONLY: 'inferred_only',
});

const USE_VIOLATIONS = Object.freeze({
  MISSING: 'missing',
  INFERRED: 'inferred_non_authoritative',
  STALE: 'stale_volatile',
});

const SOFT_STALENESS_MS = SOFT_STALENESS_DAYS * 24 * 60 * 60 * 1000;

function valueIsEmpty(field, value) {
  const def = getFieldDef(field);
  // `date` is not a live slot type, so give it the same null/undefined rule the
  // frozen gate applies to number/boolean/object.
  if (!def || def.type === 'date') return value === null || value === undefined;
  return isEmptyForGating(def, value);
}

/**
 * A field-level `authoritative: false` (the contract's Auth ✗ rows: locality,
 * goalClarity, decisionMakerPresent, parentInvolvement) is non-authoritative no
 * matter what source wrote it — those fields exist to shape phrasing only.
 */
function isAuthoritativeValue(slotMeta, fieldPath) {
  const { root } = parseFieldPath(fieldPath);
  if (isNonAuthoritativeField(root)) return false;
  const entry = normalizeSlotMetaStore(slotMeta)[fieldPath];
  if (!entry) return false;
  return isAuthoritativeSource(entry.source);
}

function isInferredValue(slotMeta, fieldPath) {
  const { root } = parseFieldPath(fieldPath);
  if (isNonAuthoritativeField(root)) return true;
  const entry = normalizeSlotMetaStore(slotMeta)[fieldPath];
  return Boolean(entry && isNonAuthoritativeSource(entry.source));
}

/**
 * @returns {{ stale: boolean, kind: 'volatile'|'soft'|null, reason: string|null }}
 *   volatile → must be RE-CONFIRMED before use (counts as empty)
 *   soft     → reusable; the LLM confirms in passing rather than re-asking cold
 */
function evaluateStaleness(fieldPath, metaEntry, options = {}) {
  const { root } = parseFieldPath(fieldPath);
  const now = options.now instanceof Date ? options.now : new Date();

  if (isVolatileField(root)) {
    const currentYear =
      options.academicYear != null ? options.academicYear : deriveAcademicYear(now);
    const setYear = metaEntry ? metaEntry.academicYear : null;
    // No recorded academic year on a volatile slot is itself un-verifiable, so
    // it is treated as stale rather than assumed current.
    if (setYear == null || setYear !== currentYear) {
      return { stale: true, kind: 'volatile', reason: EMPTY_REASONS.STALE_VOLATILE };
    }
    return { stale: false, kind: 'volatile', reason: null };
  }

  if (isSoftField(root)) {
    const setAt = metaEntry && metaEntry.setAt ? new Date(metaEntry.setAt) : null;
    if (setAt && !Number.isNaN(setAt.getTime()) && now.getTime() - setAt.getTime() > SOFT_STALENESS_MS) {
      return { stale: true, kind: 'soft', reason: null };
    }
    return { stale: false, kind: 'soft', reason: null };
  }

  return { stale: false, kind: null, reason: null };
}

/**
 * §5 nextSlot() must treat as EMPTY: an unset slot, a stale volatile slot, and a
 * slot whose only value is source='inferred'.
 *
 * @returns {{ empty: boolean, reason: string|null }}
 */
function isEmptyForNextQuestion(profile, slotMeta, fieldPath, options = {}) {
  const value = readValueAtPath(profile, fieldPath);
  const { root } = parseFieldPath(fieldPath);

  if (valueIsEmpty(root, value)) return { empty: true, reason: EMPTY_REASONS.UNSET };

  if (isInferredValue(slotMeta, fieldPath)) {
    return { empty: true, reason: EMPTY_REASONS.INFERRED_ONLY };
  }

  const metaEntry = normalizeSlotMetaStore(slotMeta)[fieldPath] || null;
  const staleness = evaluateStaleness(fieldPath, metaEntry, options);
  if (staleness.stale && staleness.kind === 'volatile') {
    return { empty: true, reason: EMPTY_REASONS.STALE_VOLATILE };
  }

  return { empty: false, reason: null };
}

function canSatisfyNextQuestion(profile, slotMeta, fieldPath, options = {}) {
  return isEmptyForNextQuestion(profile, slotMeta, fieldPath, options).empty === false;
}

/**
 * Gate check for any consumer that turns profile values into a claim about the
 * world: the predictor (S-1) and any recommendation or shortlist filter.
 *
 * @returns {{ ok: boolean, violations: Array<{ field, reason }> }}
 */
function checkUsableForDecision(profile, slotMeta, fields = [], options = {}) {
  const store = normalizeSlotMetaStore(slotMeta);
  const violations = [];

  for (const fieldPath of fields) {
    const { root } = parseFieldPath(fieldPath);
    const value = readValueAtPath(profile, fieldPath);

    if (valueIsEmpty(root, value)) {
      violations.push({ field: fieldPath, reason: USE_VIOLATIONS.MISSING });
      continue;
    }
    if (isInferredValue(slotMeta, fieldPath)) {
      violations.push({ field: fieldPath, reason: USE_VIOLATIONS.INFERRED });
      continue;
    }
    const staleness = evaluateStaleness(fieldPath, store[fieldPath] || null, options);
    if (staleness.stale && staleness.kind === 'volatile') {
      violations.push({ field: fieldPath, reason: USE_VIOLATIONS.STALE });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** S-1: predictor inputs must be authoritative and current, or not sent at all. */
function checkPredictorInputs(profile, slotMeta, fields, options = {}) {
  return checkUsableForDecision(profile, slotMeta, fields, options);
}

/** A recommendation may not be gated on an inferred or stale value. */
function canGateRecommendation(profile, slotMeta, fields, options = {}) {
  return checkUsableForDecision(profile, slotMeta, fields, options).ok;
}

/**
 * Split the profile the way a counsellor brief must render it (§4): stated
 * values as fact with their quote, inferred values separately so they can be
 * rendered as "sounds like…" and never as fact.
 */
function partitionStatedVsInferred(profile = {}, slotMeta = {}) {
  const store = normalizeSlotMetaStore(slotMeta);
  const stated = [];
  const inferred = [];

  for (const [fieldPath, entry] of Object.entries(store)) {
    const { root } = parseFieldPath(fieldPath);
    const value = readValueAtPath(profile, fieldPath);
    if (valueIsEmpty(root, value)) continue;
    const record = {
      field: fieldPath,
      value,
      source: entry.source,
      verbatimQuote: entry.verbatimQuote ?? null,
      confidence: entry.confidence ?? null,
    };
    if (isInferredValue(slotMeta, fieldPath)) inferred.push(record);
    else if (isAuthoritativeValue(slotMeta, fieldPath)) stated.push(record);
  }

  return { stated, inferred };
}

/**
 * Profile copy safe to hand to a tool: every inferred-only value removed, so an
 * inference cannot reach the predictor even if a caller forgets to check.
 */
function stripInferredValues(profile = {}, slotMeta = {}) {
  const out = { ...profile };
  const store = normalizeSlotMetaStore(slotMeta);
  for (const fieldPath of Object.keys(store)) {
    const { root, leaf } = parseFieldPath(fieldPath);
    if (leaf) continue; // nested entry fields are stripped by the tool layer, not here
    if (isInferredValue(slotMeta, fieldPath)) out[root] = null;
  }
  for (const field of Object.keys(out)) {
    if (isNonAuthoritativeField(field)) out[field] = null;
  }
  return out;
}

module.exports = {
  EMPTY_REASONS,
  USE_VIOLATIONS,
  SOFT_STALENESS_MS,
  isAuthoritativeValue,
  isInferredValue,
  evaluateStaleness,
  isEmptyForNextQuestion,
  canSatisfyNextQuestion,
  checkUsableForDecision,
  checkPredictorInputs,
  canGateRecommendation,
  partitionStatedVsInferred,
  stripInferredValues,
};
