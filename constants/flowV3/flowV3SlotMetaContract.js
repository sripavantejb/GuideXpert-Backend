'use strict';

/**
 * Flow V3 — slot-meta contract (LEAD_PROFILE_CONTRACT.md §2).
 *
 *   slotMeta: { <fieldPath>: {
 *     source ......... button | typed | extracted | inferred | counsellor | system
 *     confidence ..... 0-1     REQUIRED when source='inferred'
 *     verbatimQuote .. string  REQUIRED when source ∈ typed | extracted | inferred
 *     setAt .......... date
 *     turnId ......... string
 *     academicYear ... int     volatile fields only — drives staleness §5.2
 *     supersededBy ... turnId  set when a later turn corrects this
 *     history[] ...... prior values, append-only
 *   } }
 *
 * STORAGE KEY ENCODING. Field paths for structured-array entries contain dots
 * (`examResults.0.rank`). Mongo/Mongoose Map keys with dots are not portable, so
 * keys are stored escaped and decoded on read. The escape is reversible and
 * total: `~` → `~7e`, `.` → `~2e`, `$` → `~24`.
 */

const {
  SLOT_META_SOURCES,
  CONFIDENCE_REQUIRED_SOURCES,
  VERBATIM_REQUIRED_SOURCES,
} = require('./flowV3ProfileEnums');

const SLOT_META_FIELDS = Object.freeze([
  'source',
  'confidence',
  'verbatimQuote',
  'setAt',
  'turnId',
  'academicYear',
  'supersededBy',
  'history',
]);

const SLOT_META_REQUIRED_FIELDS = Object.freeze(['source', 'setAt', 'turnId']);

/** Fields copied into a history entry when a value is superseded. */
const SLOT_META_HISTORY_FIELDS = Object.freeze([
  'value',
  'source',
  'confidence',
  'verbatimQuote',
  'setAt',
  'turnId',
  'academicYear',
  'supersededBy',
]);

const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 1;

/**
 * Indian admission cycles run roughly June → May, so the academic year of a
 * date in Jan-May is the calendar year (that cycle's admission year) and from
 * June onwards it is the next calendar year. Staleness only needs this to be
 * consistent, not calendrical — §5.2 compares equality, never ordering.
 */
const ACADEMIC_YEAR_ROLLOVER_MONTH = 5; // 0-indexed: June

function deriveAcademicYear(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCMonth() >= ACADEMIC_YEAR_ROLLOVER_MONTH
    ? date.getUTCFullYear() + 1
    : date.getUTCFullYear();
}

const SLOT_META_KEY_ESCAPES = Object.freeze([
  ['~', '~7e'],
  ['.', '~2e'],
  ['$', '~24'],
]);

function encodeSlotMetaKey(fieldPath) {
  let out = String(fieldPath);
  for (const [raw, escaped] of SLOT_META_KEY_ESCAPES) {
    out = out.split(raw).join(escaped);
  }
  return out;
}

function decodeSlotMetaKey(storedKey) {
  let out = String(storedKey);
  // Reverse order so the `~` escape is undone last and cannot re-introduce
  // sequences produced by the other two.
  for (const [raw, escaped] of [...SLOT_META_KEY_ESCAPES].reverse()) {
    out = out.split(escaped).join(raw);
  }
  return out;
}

function isConfidenceRequired(source) {
  return CONFIDENCE_REQUIRED_SOURCES.includes(source);
}

function isVerbatimRequired(source) {
  return VERBATIM_REQUIRED_SOURCES.includes(source);
}

function isKnownSource(source) {
  return SLOT_META_SOURCES.includes(source);
}

/**
 * Lightweight meta-shape check used by foundation tests and any caller that
 * only needs source/confidence/quote rules (not field-path knowledge).
 * Field-path-aware validation lives in profile/flowV3SlotMeta.validateSlotMetaEntry.
 */
function validateSlotMeta(meta, opts = {}) {
  const path = opts.path || 'slot';
  if (!meta || typeof meta !== 'object') {
    return { ok: false, error: `${path}: slotMeta is required` };
  }
  const source = meta.source;
  if (!isKnownSource(source)) {
    return { ok: false, error: `${path}: invalid source '${source}'` };
  }
  if (isConfidenceRequired(source)) {
    const confidence = Number(meta.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE || confidence > MAX_CONFIDENCE) {
      return { ok: false, error: `${path}: inferred source requires confidence in [0,1]` };
    }
  }
  if (isVerbatimRequired(source)) {
    if (typeof meta.verbatimQuote !== 'string' || !meta.verbatimQuote.trim()) {
      return { ok: false, error: `${path}: source '${source}' requires verbatimQuote` };
    }
  }
  return {
    ok: true,
    meta: {
      source,
      confidence: meta.confidence == null ? null : Number(meta.confidence),
      verbatimQuote: meta.verbatimQuote == null ? null : String(meta.verbatimQuote),
      setAt: meta.setAt ? new Date(meta.setAt) : new Date(),
      turnId: meta.turnId == null ? null : String(meta.turnId),
      academicYear: meta.academicYear == null ? null : Number(meta.academicYear),
      supersededBy: meta.supersededBy == null ? null : String(meta.supersededBy),
      history: Array.isArray(meta.history) ? meta.history : [],
    },
  };
}

module.exports = {
  SLOT_META_FIELDS,
  SLOT_META_REQUIRED_FIELDS,
  SLOT_META_HISTORY_FIELDS,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
  ACADEMIC_YEAR_ROLLOVER_MONTH,
  SLOT_META_KEY_ESCAPES,
  deriveAcademicYear,
  encodeSlotMetaKey,
  decodeSlotMetaKey,
  isConfidenceRequired,
  isVerbatimRequired,
  isKnownSource,
  validateSlotMeta,
};
