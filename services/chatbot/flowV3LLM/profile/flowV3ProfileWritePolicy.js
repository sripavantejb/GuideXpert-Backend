'use strict';

/**
 * Flow V3 — write allowlist (LEAD_PROFILE_CONTRACT.md §5, RULE B).
 *
 * "Enforce as a tool-level allowlist, not a prompt instruction." A prompt
 * instruction is a request; this is the enforcement. The LLM may not write:
 *
 *   group H (engagement)      code computes behaviour; a model scoring its own
 *                             conversation will flatter it
 *   group I (funnel state)    leadStage is monotonic and code-written
 *   code-owned J / K          what was shown, and what the counsellor found
 *   consentAt · consentVersion · isMinor
 *   leadStage · bookingStatus · crisisLocked
 *   any Tier 3 or Tier 4 field, including examResults[].category / .gender
 *
 * Tier 3 stays writable by the system / button / extracted / counsellor paths —
 * the predictor needs `category` and `gender`, and the S-1 gate needs them to be
 * REAL. What is forbidden is a model inventing them.
 *
 * consentAt / consentVersion / isMinor are blocked on EVERY channel, including
 * system, until the open items in §3 are closed. Writing a consent timestamp
 * before the disclosure copy exists would record consent that was never asked
 * for. TODO(copy) for the disclosure line, TODO(decision) for DPDP minors.
 */

const {
  FLOW_V3_PROFILE_SCHEMA,
  LLM_BLOCKED_FIELDS,
  LLM_BLOCKED_NESTED_PATHS,
  SYSTEM_WRITE_BLOCKED_FIELDS,
  EXCLUDED_FIELD_NAME_PATTERNS,
  isKnownField,
  isStructuredArrayField,
  getStructuredArraySpec,
  getFieldDef,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const { WRITE_CHANNELS, LLM_WRITE_CHANNEL } = require('../../../../constants/flowV3/flowV3ProfileEnums');
const { validateSlotMetaEntry, SLOT_META_ERRORS } = require('./flowV3SlotMeta');

const WRITE_POLICY_CODES = Object.freeze({
  UNKNOWN_FIELD: 'WRITE_UNKNOWN_FIELD',
  UNKNOWN_CHANNEL: 'WRITE_UNKNOWN_CHANNEL',
  LLM_BLOCKED: 'WRITE_LLM_BLOCKED_FIELD',
  SYSTEM_BLOCKED: 'WRITE_SYSTEM_BLOCKED_FIELD',
  NESTED_BLOCKED: 'WRITE_NESTED_FIELD_BLOCKED',
  EXCLUDED_CATEGORY: 'WRITE_EXCLUDED_CATEGORY',
  META_MISSING: 'WRITE_META_MISSING',
  INVALID_ENUM: 'WRITE_INVALID_ENUM',
  INVALID_ENTRY: 'WRITE_INVALID_STRUCTURED_ENTRY',
});

function isExcludedFieldName(field) {
  return EXCLUDED_FIELD_NAME_PATTERNS.some((pattern) => pattern.test(String(field)));
}

/**
 * @returns {{ allowed: boolean, code: string|null, message: string|null }}
 */
function isWritableByChannel(field, channel) {
  if (!WRITE_CHANNELS.includes(channel)) {
    return {
      allowed: false,
      code: WRITE_POLICY_CODES.UNKNOWN_CHANNEL,
      message: `unknown write channel: ${String(channel)}`,
    };
  }
  if (isExcludedFieldName(field)) {
    return {
      allowed: false,
      code: WRITE_POLICY_CODES.EXCLUDED_CATEGORY,
      message: `${field} belongs to a §3 DO NOT BUILD category`,
    };
  }
  if (!isKnownField(field)) {
    return {
      allowed: false,
      code: WRITE_POLICY_CODES.UNKNOWN_FIELD,
      message: `${field} is not in the profile schema`,
    };
  }
  if (SYSTEM_WRITE_BLOCKED_FIELDS.includes(field)) {
    return {
      allowed: false,
      code: WRITE_POLICY_CODES.SYSTEM_BLOCKED,
      message: `${field} is write-blocked on every channel pending the §3 open items`,
    };
  }
  if (channel === LLM_WRITE_CHANNEL && LLM_BLOCKED_FIELDS.includes(field)) {
    return {
      allowed: false,
      code: WRITE_POLICY_CODES.LLM_BLOCKED,
      message: `${field} is not writable by the LLM tool (group ${getFieldDef(field).group}, tier ${
        getFieldDef(field).sens
      })`,
    };
  }
  return { allowed: true, code: null, message: null };
}

function enumViolation(field, def, value) {
  if (!def || !Array.isArray(def.enumValues)) return null;
  const values = def.type === 'array' ? (Array.isArray(value) ? value : [value]) : [value];
  const bad = values.filter((item) => item !== null && item !== undefined && !def.enumValues.includes(item));
  return bad.length ? bad : null;
}

/**
 * Sanitize structured-array entries. Two different failures, two different
 * outcomes, on purpose:
 *
 *   BLOCKED FIELD (Tier 3) → strip the field, keep the entry. An exam result is
 *     still worth storing without `category`; the predictor will ask for it
 *     through an authoritative path.
 *   OUT-OF-ENUM VALUE  → drop the WHOLE entry. A half-written entry — an
 *     objection with no valid `type`, an artifact with no valid `kind` — is worse
 *     than no entry: it pollutes the array with a record nothing can interpret,
 *     and the rejection tells the caller to send it again properly.
 */
function sanitizeStructuredEntries(field, value, channel, rejected) {
  const spec = getStructuredArraySpec(field);
  const entries = Array.isArray(value) ? value : [value];
  const out = [];

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      rejected.push({
        field,
        code: WRITE_POLICY_CODES.INVALID_ENTRY,
        message: `${field} entries must be objects`,
      });
      continue;
    }

    const entry = {};
    let entryRejected = false;

    for (const [entryField, entryValue] of Object.entries(rawEntry)) {
      const path = `${field}.${entryField}`;
      const itemDef = spec && spec.fields ? spec.fields[entryField] : null;

      if (!itemDef) {
        // Unknown entry fields are dropped: the spec is the contract.
        continue;
      }
      if (channel === LLM_WRITE_CHANNEL && LLM_BLOCKED_NESTED_PATHS.includes(path)) {
        rejected.push({
          field: path,
          code: WRITE_POLICY_CODES.NESTED_BLOCKED,
          message: `${path} is Tier 3 — authoritative-only, never written by the LLM tool`,
        });
        continue;
      }
      const bad = enumViolation(path, itemDef, entryValue);
      if (bad) {
        rejected.push({
          field: path,
          code: WRITE_POLICY_CODES.INVALID_ENUM,
          message: `${path} received out-of-enum value(s): ${bad.join(', ')}`,
        });
        entryRejected = true;
        continue;
      }
      entry[entryField] = entryValue;
    }

    if (!entryRejected && Object.keys(entry).length) out.push(entry);
  }

  return out;
}

/**
 * Validate an `update_lead_profile(patch)` call.
 *
 * Per §5 every patch key must carry capture meta: `source` plus `verbatimQuote`
 * for free-text-derived sources, plus `confidence` when `source='inferred'`. A
 * key with `source='inferred'` and no confidence is REJECTED, not silently
 * accepted — a confidence-free inference is indistinguishable from a statement
 * once it is in the document.
 *
 * @param {{ patch: object, meta?: object, channel?: string, turnId?: string, now?: Date }} input
 * @returns {{ ok, accepted, acceptedMeta, rejected, dropped }}
 */
function validateProfilePatch(input = {}) {
  const { patch = {}, meta = {}, channel = LLM_WRITE_CHANNEL, turnId = null, now = null } = input;
  const accepted = {};
  const acceptedMeta = {};
  const rejected = [];
  const dropped = [];

  for (const [field, value] of Object.entries(patch || {})) {
    const permission = isWritableByChannel(field, channel);
    if (!permission.allowed) {
      // An unknown key is a schema mismatch, not an attack: dropped, per §6.
      // Everything else is an explicit refusal the caller must see.
      if (permission.code === WRITE_POLICY_CODES.UNKNOWN_FIELD) {
        dropped.push({ field, code: permission.code, message: permission.message });
      } else {
        rejected.push({ field, code: permission.code, message: permission.message });
      }
      continue;
    }

    const metaEntry = meta && meta[field] ? { ...meta[field] } : null;
    if (!metaEntry) {
      rejected.push({
        field,
        code: WRITE_POLICY_CODES.META_MISSING,
        message: `${field} requires capture meta { source, verbatimQuote }`,
      });
      continue;
    }
    if (metaEntry.turnId == null && turnId != null) metaEntry.turnId = turnId;

    const metaCheck = validateSlotMetaEntry(field, metaEntry);
    if (!metaCheck.valid) {
      for (const error of metaCheck.errors) {
        rejected.push({ field, code: error.code, message: error.message });
      }
      continue;
    }

    const def = FLOW_V3_PROFILE_SCHEMA[field];

    if (isStructuredArrayField(field)) {
      const beforeCount = rejected.length;
      const entries = sanitizeStructuredEntries(field, value, channel, rejected);
      if (!entries.length) {
        if (rejected.length === beforeCount) {
          rejected.push({
            field,
            code: WRITE_POLICY_CODES.INVALID_ENTRY,
            message: `${field} produced no writable entries`,
          });
        }
        continue;
      }
      accepted[field] = entries;
      acceptedMeta[field] = metaEntry;
      continue;
    }

    const bad = enumViolation(field, def, value);
    if (bad) {
      rejected.push({
        field,
        code: WRITE_POLICY_CODES.INVALID_ENUM,
        message: `${field} received out-of-enum value(s): ${bad.join(', ')}`,
      });
      continue;
    }

    accepted[field] = value;
    acceptedMeta[field] = metaEntry;
  }

  return {
    ok: rejected.length === 0,
    accepted,
    acceptedMeta,
    rejected,
    dropped,
    channel,
    now,
  };
}

/** Convenience for the tool layer: the LLM-facing channel is the strict one. */
function validateLlmToolPatch(patch, meta, options = {}) {
  return validateProfilePatch({ ...options, patch, meta, channel: LLM_WRITE_CHANNEL });
}

module.exports = {
  WRITE_POLICY_CODES,
  SLOT_META_ERRORS,
  isExcludedFieldName,
  isWritableByChannel,
  sanitizeStructuredEntries,
  validateProfilePatch,
  validateLlmToolPatch,
};
