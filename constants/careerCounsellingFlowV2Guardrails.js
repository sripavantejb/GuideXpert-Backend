'use strict';

/**
 * Flow v2 — shared guardrail patterns.
 *
 * Net-new for Flow v2 only. NOT imported by, and does not import from, any
 * existing `careerCounsellingV2*.js` file. The existing per-phase
 * `GUARANTEE_FORBIDDEN` arrays (Phase 10/11/12/13, NIAT — 5 files total)
 * are left exactly as they are; this module is the union of those patterns,
 * deduplicated by exact regex source+flags, so Flow v2 beats have one
 * canonical list to import from day one instead of repeating the
 * 5-file-duplication pattern found in the audit.
 *
 * Sources consolidated (for traceability):
 *  - constants/careerCounsellingV2FuturePathVision.js (Phase 10)
 *  - constants/careerCounsellingV2FinalDecisionHesitation.js (Phase 11)
 *  - constants/careerCounsellingV2CounselingExperienceSelection.js (Phase 12)
 *  - constants/careerCounsellingV2BookingOrchestrator.js (Phase 13)
 *  - constants/careerCounsellingV2NiatInterest.js (NIAT funnel)
 */

const GUARANTEE_FORBIDDEN = Object.freeze([
  /\bguaranteed?\b/i, // Phase 10, 11, 12, 13, NIAT
  /\bassure[ds]?\b/i, // Phase 10, 11, 12, 13, NIAT
  /\bwill (get|secure|land)\b/i, // Phase 10, 11, 12, 13
  /\bwill (get|secure|land) (admission|scholarship|placement)\b/i, // NIAT (more specific variant)
  /\b100%\b/, // Phase 10, 11, 12, 13, NIAT
  /\bplacement(s)? (guaranteed|assured|confirmed)\b/i, // Phase 10
  /\bpackage (of|is|will)\b/i, // Phase 10
  /\badmission (guaranteed|assured|confirmed)\b/i, // Phase 10
  /\bmust (decide|choose) now\b/i, // Phase 11
  /\byou have to\b/i, // Phase 11, 12, 13
  /\byou have to (book|join)\b/i, // NIAT (more specific variant)
  /\bmust (book|decide|join)\b/i, // Phase 12, 13
  /\bmust (book|decide)\b/i, // NIAT (narrower variant)
  /\bmandatory\b/i, // Phase 12, 13, NIAT
]);

/** Same pattern family as Phase 12's URL_FORBIDDEN. */
const URL_FORBIDDEN = Object.freeze([/https?:\/\//i, /guidexpert\.co\.in/i, /www\./i]);

/**
 * Usage split (documented now so Phase 2 doesn't have to relitigate it):
 *  - `assertGuardrails()` — use for B6 (The Case). A guardrail violation in
 *    generated copy at that beat must hard-fail, not silently log.
 *  - `collectGuardrailViolations()` — use for any earlier beat that
 *    generates free text and wants a soft warning instead of a throw.
 *
 * Check `text` against any number of pattern-list arguments and return the
 * violations found (empty array = clean). Defaults to
 * [GUARANTEE_FORBIDDEN, URL_FORBIDDEN] when no lists are passed.
 *
 * @param {string} text
 * @param {...RegExp[]} listsToCheck
 * @returns {{ pattern: string, listIndex: number }[]}
 */
function collectGuardrailViolations(text, ...listsToCheck) {
  const t = String(text || '');
  const lists = listsToCheck.length ? listsToCheck : [GUARANTEE_FORBIDDEN, URL_FORBIDDEN];
  const violations = [];
  lists.forEach((list, listIndex) => {
    (list || []).forEach((pattern) => {
      if (pattern.test(t)) {
        violations.push({ pattern: String(pattern), listIndex });
      }
    });
  });
  return violations;
}

/**
 * Usage split — see `collectGuardrailViolations()` above:
 *  - `assertGuardrails()` — use for B6 (The Case), where a violation must
 *    hard-fail. Throws on the first violation found (mirrors the existing
 *    `assertPhase12Guardrails` precedent in
 *    careerCounsellingV2CounselingExperienceSelectionCore.js), returning
 *    the checked text unchanged on success.
 *  - Use `collectGuardrailViolations()` directly instead if you want a
 *    non-throwing violation report (soft warning) rather than a hard-fail.
 *
 * @param {string} text
 * @param {...RegExp[]} listsToCheck
 * @returns {string}
 */
function assertGuardrails(text, ...listsToCheck) {
  const violations = collectGuardrailViolations(text, ...listsToCheck);
  if (violations.length) {
    throw new Error(`Flow v2 guardrail violation: ${violations.map((v) => v.pattern).join(', ')}`);
  }
  return text;
}

module.exports = {
  GUARANTEE_FORBIDDEN,
  URL_FORBIDDEN,
  collectGuardrailViolations,
  assertGuardrails,
};
