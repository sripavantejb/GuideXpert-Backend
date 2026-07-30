'use strict';

/**
 * G-DEMOGRAPHIC (audit S-1) — highest-value gate.
 *
 * Runs post-merge on EVERY turn, not just at predictor entry, because the
 * condition can become true mid-fill. `get_predictor_matches` enforces the same
 * rule independently (belt and suspenders), so a prompt regression cannot
 * produce a rank list for a blocked student.
 *
 * Refusal copy ships verbatim from r4pPredictor.js — never LLM-paraphrased.
 */

const {
  isBlockedDemographic,
  BLOCKED_REPLY_TEXT,
  BLOCKED_BUTTONS,
  resolveLegacyExam,
} = require('../../flowV2/nodes/r4pPredictor');

const EXAM_ALIASES = Object.freeze({
  ap_eamcet: 'AP_EAMCET',
  apeamcet: 'AP_EAMCET',
  'ap eamcet': 'AP_EAMCET',
  ts_eamcet: 'TS_EAMCET',
  tseamcet: 'TS_EAMCET',
  'ts eamcet': 'TS_EAMCET',
});

function normalizeExamType(examType) {
  if (examType == null || examType === '') return null;
  const raw = String(examType).trim();
  const aliased = EXAM_ALIASES[raw.toLowerCase()] || raw;
  return resolveLegacyExam(aliased) || aliased;
}

/**
 * @param {object} profile post-merge profile
 * @returns {{ blocked: boolean, copy: string|null, buttons: ReadonlyArray|null }}
 */
function evaluateDemographicGate(profile = {}) {
  const candidate = { ...(profile || {}) };
  const canonical = normalizeExamType(candidate.examType);
  if (canonical) candidate.examType = canonical;

  if (!isBlockedDemographic(candidate)) {
    return { blocked: false, copy: null, buttons: null };
  }
  return {
    blocked: true,
    copy: BLOCKED_REPLY_TEXT,
    buttons: BLOCKED_BUTTONS,
  };
}

module.exports = {
  evaluateDemographicGate,
  normalizeExamType,
  BLOCKED_REPLY_TEXT,
};
