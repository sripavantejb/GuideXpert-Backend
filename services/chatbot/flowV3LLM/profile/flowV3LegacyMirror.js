'use strict';

/**
 * Flow V3 — legacy mirrors (LEAD_PROFILE_CONTRACT.md §1.C, §1.G, §5).
 *
 * ONE-DIRECTIONAL, ALWAYS. Every mirror here reads a V3 field and writes a
 * legacy slot that Flow V2 and the predictor still read. Nothing in this module
 * ever reads a legacy slot back into its V3 source:
 *
 *   examResults[isPrimary]  →  examType · rank · percentile · category · gender ·
 *                              quota · region · admissionType
 *   parentConstraintsList[] →  parentConstraints   (join)
 *   collegeOfInterestList[] →  collegeOfInterest   (join)
 *   objections[].type       →  concerns[]          (append + dedupe)
 *
 * Reverse hydration is what would let a lossy legacy string (a comma-join, a
 * single overwritten exam) silently become the source of truth again and undo
 * the modelling fix. `mirrorDirection` is exported so the rule is visible in
 * code, and the mirror functions are pure so it is testable.
 */

const {
  EXAM_LEGACY_MIRROR_MAP,
  COMPANION_FIELDS,
  OBJECTION_LEGACY_MIRROR_TARGET,
  LEGACY_JOIN_SEPARATOR,
  getStructuredArraySpec,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const { dedupeArray } = require('../../flowV2/flowV2ProfileMerge');

const MIRROR_DIRECTION = 'v3_to_legacy_only';

const MIRROR_WARNINGS = Object.freeze({
  PRIMARY_EXAM_UNRESOLVED: 'MIRROR_PRIMARY_EXAM_UNRESOLVED',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * The exam the student is banking on. Explicit `isPrimary` only, with one
 * documented exception: a single exam entry with no flag is that student's only
 * exam, so it is treated as primary rather than leaving the predictor with no
 * mirrored rank at all.
 */
function getPrimaryExamResult(profile = {}) {
  const entries = asArray(profile.examResults).filter((entry) => entry && typeof entry === 'object');
  if (!entries.length) return null;
  const flagged = entries.find((entry) => entry.isPrimary === true);
  if (flagged) return flagged;
  return entries.length === 1 ? entries[0] : null;
}

/**
 * @returns {{ patch: object, warnings: string[] }} legacy flat slots derived
 * from the primary exam entry. Null entry fields are skipped — the mirror is
 * additive, exactly like the merge it feeds.
 */
function mirrorExamResultsToLegacy(profile = {}) {
  const entries = asArray(profile.examResults);
  if (!entries.length) return { patch: {}, warnings: [] };

  const primary = getPrimaryExamResult(profile);
  if (!primary) {
    return { patch: {}, warnings: [MIRROR_WARNINGS.PRIMARY_EXAM_UNRESOLVED] };
  }

  const patch = {};
  for (const [legacyField, entryField] of Object.entries(EXAM_LEGACY_MIRROR_MAP)) {
    const value = primary[entryField];
    if (isBlank(value)) continue;
    patch[legacyField] = value;
  }
  return { patch, warnings: [] };
}

/** Companion array → legacy string, joined. Never split back. */
function mirrorCompanionsToLegacy(profile = {}) {
  const patch = {};
  for (const [companionField, legacyField] of Object.entries(COMPANION_FIELDS)) {
    const values = asArray(profile[companionField])
      .filter((value) => !isBlank(value))
      .map((value) => (typeof value === 'string' ? value.trim() : String(value)));
    if (!values.length) continue;
    patch[legacyField] = dedupeArray(values).join(LEGACY_JOIN_SEPARATOR);
  }
  return { patch, warnings: [] };
}

/** objections[].type → concerns[] (Flow V2 reads concerns). Append + dedupe. */
function mirrorObjectionsToLegacyConcerns(profile = {}) {
  const spec = getStructuredArraySpec('objections');
  if (!spec) return { patch: {}, warnings: [] };
  const types = asArray(profile.objections)
    .filter((entry) => entry && typeof entry === 'object' && !isBlank(entry.type))
    .map((entry) => entry.type);
  if (!types.length) return { patch: {}, warnings: [] };
  const existing = asArray(profile[OBJECTION_LEGACY_MIRROR_TARGET]);
  return {
    patch: { [OBJECTION_LEGACY_MIRROR_TARGET]: dedupeArray([...existing, ...types]) },
    warnings: [],
  };
}

/**
 * Apply every mirror. Mirrors run AFTER the merge, so a mirrored legacy slot
 * always reflects its V3 source rather than whatever a writer put in the flat
 * slot in the same patch.
 *
 * @returns {{ profile: object, mirrored: object, warnings: string[] }}
 */
function applyLegacyMirrors(profile = {}, options = {}) {
  const mirrors = [
    mirrorExamResultsToLegacy(profile),
    mirrorCompanionsToLegacy(profile),
    mirrorObjectionsToLegacyConcerns(profile),
  ];

  const mirrored = {};
  const warnings = [];
  for (const mirror of mirrors) {
    Object.assign(mirrored, mirror.patch);
    warnings.push(...mirror.warnings);
  }

  const next = { ...profile, ...mirrored };
  if (options.mutate === true) Object.assign(profile, mirrored);
  return { profile: next, mirrored, warnings };
}

/**
 * Convenience for call sites that only need the mirrored profile.
 * Never guesses a primary when multiple examResults lack isPrimary.
 */
function mirrorPrimaryExamToLegacy(profile = {}) {
  return applyLegacyMirrors(profile).profile;
}

module.exports = {
  MIRROR_DIRECTION,
  MIRROR_WARNINGS,
  getPrimaryExamResult,
  mirrorExamResultsToLegacy,
  mirrorCompanionsToLegacy,
  mirrorObjectionsToLegacyConcerns,
  applyLegacyMirrors,
  mirrorPrimaryExamToLegacy,
};
