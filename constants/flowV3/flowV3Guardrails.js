'use strict';

/**
 * Flow V3 canonical guardrails.
 *
 * Imports the verified exact union from Flow V2. Documented “16-pattern”
 * count is inaccurate; the live union has 14 patterns and contains every
 * exact pattern from Phase 10/11/12/13 + NIAT (proved by test).
 *
 * Do NOT edit the five frozen phase copies (G-7 deferred).
 */

const {
  GUARANTEE_FORBIDDEN,
  URL_FORBIDDEN,
  collectGuardrailViolations,
  assertGuardrails,
} = require('../careerCounsellingFlowV2Guardrails');

module.exports = {
  GUARANTEE_FORBIDDEN,
  URL_FORBIDDEN,
  collectGuardrailViolations,
  assertGuardrails,
};
