'use strict';

/**
 * isMinor resolution policy.
 *
 * NOT derived from passingYear. Passing year misclassifies droppers, lateral
 * entrants and repeat-attempt students, and isMinor is legally significant —
 * a wrong `false` is the expensive direction.
 *
 * Rule: default TRUE for the school-leaving cohort unless a STATED age (or a
 * stated date of birth) says otherwise. Inference never produces `false`.
 *
 * Writes remain blocked on every channel until the consent copy exists
 * (TODO(copy) — owned by product + legal, not drafted here).
 *
 * PRODUCTION WIRING: no tool, gate, or store path currently calls
 * `resolveIsMinor`. The module and its tests are kept so the policy is ready
 * when the consent copy lands; do not delete as "orphaned".
 */

const MINOR_AGE_THRESHOLD = 18;

const IS_MINOR_REASONS = Object.freeze({
  STATED_AGE_ADULT: 'stated_age_adult',
  STATED_AGE_MINOR: 'stated_age_minor',
  CONSERVATIVE_DEFAULT: 'conservative_default_school_leaving_cohort',
  INVALID_STATED_AGE: 'invalid_stated_age_ignored',
});

function normalizeStatedAge(statedAge) {
  if (statedAge === null || statedAge === undefined || statedAge === '') return null;
  const age = Number(statedAge);
  if (!Number.isFinite(age) || age <= 0 || age > 120) return null;
  return age;
}

/**
 * @param {{ statedAge?: number|string|null, source?: string|null }} input
 * @returns {{ isMinor: boolean, reason: string, authoritative: boolean }}
 */
function resolveIsMinor(input = {}) {
  const age = normalizeStatedAge(input.statedAge);

  if (input.statedAge != null && input.statedAge !== '' && age === null) {
    return {
      isMinor: true,
      reason: IS_MINOR_REASONS.INVALID_STATED_AGE,
      authoritative: false,
    };
  }

  if (age !== null) {
    // Only a stated age may produce `false`; an inferred source never can.
    const stated = input.source && input.source !== 'inferred';
    if (age >= MINOR_AGE_THRESHOLD && stated) {
      return { isMinor: false, reason: IS_MINOR_REASONS.STATED_AGE_ADULT, authoritative: true };
    }
    if (age < MINOR_AGE_THRESHOLD) {
      return { isMinor: true, reason: IS_MINOR_REASONS.STATED_AGE_MINOR, authoritative: Boolean(stated) };
    }
  }

  return {
    isMinor: true,
    reason: IS_MINOR_REASONS.CONSERVATIVE_DEFAULT,
    authoritative: false,
  };
}

/** Guard so no caller can reintroduce a passingYear-based derivation. */
function assertNotDerivedFromPassingYear(fieldsUsed = []) {
  if (fieldsUsed.includes('passingYear') || fieldsUsed.includes('targetAdmissionYear')) {
    throw new Error('isMinor must not be derived from passingYear/targetAdmissionYear');
  }
}

module.exports = {
  MINOR_AGE_THRESHOLD,
  IS_MINOR_REASONS,
  resolveIsMinor,
  assertNotDerivedFromPassingYear,
};
