'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  GUARANTEE_FORBIDDEN,
} = require('../../constants/flowV3/flowV3Guardrails');
const {
  GUARANTEE_FORBIDDEN: PHASE10,
} = require('../../constants/careerCounsellingV2FuturePathVision');
const {
  GUARANTEE_FORBIDDEN: PHASE11,
} = require('../../constants/careerCounsellingV2FinalDecisionHesitation');
const {
  GUARANTEE_FORBIDDEN: PHASE12,
} = require('../../constants/careerCounsellingV2CounselingExperienceSelection');
const {
  GUARANTEE_FORBIDDEN: PHASE13,
} = require('../../constants/careerCounsellingV2BookingOrchestrator');
const {
  GUARANTEE_FORBIDDEN: NIAT,
} = require('../../constants/careerCounsellingV2NiatInterest');

function patternKey(re) {
  return `${re.source}::${re.flags}`;
}

describe('flowV3Guardrails union', () => {
  test('re-exports exact 14-pattern union', () => {
    assert.equal(GUARANTEE_FORBIDDEN.length, 14);
  });

  test('contains every exact pattern from Phase 10/11/12/13 + NIAT', () => {
    const unionKeys = new Set(GUARANTEE_FORBIDDEN.map(patternKey));
    const sources = [
      ['phase10', PHASE10],
      ['phase11', PHASE11],
      ['phase12', PHASE12],
      ['phase13', PHASE13],
      ['niat', NIAT],
    ];
    for (const [label, arr] of sources) {
      assert.ok(Array.isArray(arr), `${label} GUARANTEE_FORBIDDEN missing`);
      for (const re of arr) {
        assert.ok(
          unionKeys.has(patternKey(re)),
          `${label} pattern /${re.source}/ missing from Flow V3 union`
        );
      }
    }
  });

  test('union has no duplicate source+flag pairs', () => {
    const keys = GUARANTEE_FORBIDDEN.map(patternKey);
    assert.equal(keys.length, new Set(keys).size);
  });

  test('union includes /\\bmandatory\\b/', () => {
    assert.ok(
      GUARANTEE_FORBIDDEN.some((re) => re.source === '\\bmandatory\\b'),
      'expected /\\bmandatory\\b/ in the canonical union'
    );
  });
});
