'use strict';

/**
 * Flow V3 — derived reads for the four contract/live type conflicts.
 *
 * The contract wants `coreInterest` as a bool and `goalPriority` as a scalar
 * enum; the live slots are a string and an array and stay that way (Flow V2 and
 * the predictor read them). Rather than add a second field holding the same fact
 * — which is how two sources of truth for one slot start — the contract's
 * reading is DERIVED here, at read time, from the live value.
 *
 * `parentConstraints` and `collegeOfInterest` are different: a string genuinely
 * cannot hold multiple constraints or multiple colleges, so those two get
 * companion arrays and the accessors below expose both sides.
 */

const {
  COMPANION_FIELDS,
  LEGACY_JOIN_SEPARATOR,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const { getPrimaryExamResult } = require('./flowV3LegacyMirror');

/**
 * Live `coreInterest` values that mean "asked, and the answer is no". Anything
 * else non-empty names a core field and therefore means yes.
 */
const CORE_INTEREST_NEGATIVE_VALUES = Object.freeze(['none', 'no', 'not_core', 'na', 'nil']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Contract §1.D `coreInterest: bool`, derived from the live string slot.
 * TRI-STATE, matching the live schema's own policy: `null` = never asked.
 */
function deriveCoreInterest(profile = {}) {
  const value = profile.coreInterest;
  if (isBlank(value)) return null;
  const normalized = String(value).trim().toLowerCase();
  return !CORE_INTEREST_NEGATIVE_VALUES.includes(normalized);
}

/** The specific core field named (mechanical/civil/ece), or null. */
function getCoreInterestField(profile = {}) {
  return deriveCoreInterest(profile) === true ? String(profile.coreInterest).trim() : null;
}

/**
 * Contract §1.D `goalPriority: enum`, derived as the head of the live ordered
 * array — the thing that matters MOST is the scalar the contract means.
 */
function getGoalPriorityScalar(profile = {}) {
  const list = asArray(profile.goalPriority).filter((value) => !isBlank(value));
  return list.length ? list[0] : null;
}

function getGoalPriorityList(profile = {}) {
  return asArray(profile.goalPriority).filter((value) => !isBlank(value));
}

/** Companion array is the source of truth; the legacy string is its join. */
function getParentConstraintsList(profile = {}) {
  const list = asArray(profile.parentConstraintsList).filter((value) => !isBlank(value));
  if (list.length) return list;
  return isBlank(profile.parentConstraints) ? [] : [String(profile.parentConstraints).trim()];
}

function getParentConstraintsScalar(profile = {}) {
  const list = getParentConstraintsList(profile);
  return list.length ? list.join(LEGACY_JOIN_SEPARATOR) : null;
}

function getCollegeOfInterestList(profile = {}) {
  const list = asArray(profile.collegeOfInterestList).filter((value) => !isBlank(value));
  if (list.length) return list;
  return isBlank(profile.collegeOfInterest) ? [] : [String(profile.collegeOfInterest).trim()];
}

function getCollegeOfInterestScalar(profile = {}) {
  const list = getCollegeOfInterestList(profile);
  return list.length ? list.join(LEGACY_JOIN_SEPARATOR) : null;
}

/**
 * Reading a companion's legacy string as a list is a LAST RESORT, not a
 * round-trip: the single-value fallback above is used only when the companion is
 * empty (a profile written before V3, or by Flow V2). The split is deliberately
 * not implemented — a comma-joined string cannot be un-joined safely when a
 * value itself contains a comma.
 */
const COMPANION_FALLBACK_IS_SINGLE_VALUE = true;

/**
 * Bundled read-time views formerly exported from flowV3ExamMirror.
 * Prefer the named accessors above for new call sites.
 */
function deriveReadViews(profile = {}) {
  return {
    coreInterestBool: deriveCoreInterest(profile),
    goalPriorityEnum: getGoalPriorityScalar(profile),
    parentConstraintsList: getParentConstraintsList(profile),
    collegeOfInterestList: getCollegeOfInterestList(profile),
  };
}

module.exports = {
  CORE_INTEREST_NEGATIVE_VALUES,
  COMPANION_FIELDS,
  COMPANION_FALLBACK_IS_SINGLE_VALUE,
  deriveCoreInterest,
  getCoreInterestField,
  getGoalPriorityScalar,
  getGoalPriorityList,
  getParentConstraintsList,
  getParentConstraintsScalar,
  getCollegeOfInterestList,
  getCollegeOfInterestScalar,
  getPrimaryExamResult,
  deriveReadViews,
};
