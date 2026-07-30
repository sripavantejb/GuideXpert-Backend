'use strict';

/**
 * A-6 — contract §3 DO NOT BUILD must stay absent from the schema forever.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FLOW_V3_PROFILE_SCHEMA,
  ALL_FIELD_KEYS,
  EXCLUDED_FIELD_NAME_PATTERNS,
  EXCLUDED_FIELD_CATEGORIES,
  isKnownField,
} = require('../../constants/flowV3/flowV3LeadProfileSchema');

const FORBIDDEN_EXAMPLES = [
  'personalityType',
  'emotionalState',
  'desperation_score',
  'easily_pressured',
  'persuasionVulnerability',
  'urgency_susceptibility',
  'responds_to_urgency',
  'inferredCaste',
  'casteGuess',
  'religionInferred',
  'socioeconomicClass',
  'estimatedFamilyIncome',
  'family_income_estimate',
  'affluenceScore',
  'anxietyLevel',
  'low_confidence',
];

describe('LEAD_PROFILE_CONTRACT §3 DO NOT BUILD', () => {
  test('excluded categories are documented on the schema module', () => {
    assert.ok(EXCLUDED_FIELD_CATEGORIES.length >= 5);
    assert.ok(
      EXCLUDED_FIELD_CATEGORIES.some((c) => /personality|emotional/i.test(c))
    );
    assert.ok(EXCLUDED_FIELD_CATEGORIES.some((c) => /persuasion|urgency/i.test(c)));
    assert.ok(EXCLUDED_FIELD_CATEGORIES.some((c) => /caste|socio/i.test(c)));
    assert.ok(EXCLUDED_FIELD_CATEGORIES.some((c) => /income|affluence/i.test(c)));
  });

  test('no schema field name matches an excluded pattern', () => {
    const hits = [];
    for (const key of ALL_FIELD_KEYS) {
      for (const pattern of EXCLUDED_FIELD_NAME_PATTERNS) {
        if (pattern.test(key)) hits.push(`${key} ~ ${pattern}`);
      }
    }
    assert.deepEqual(hits, []);
  });

  test('forbidden example names are not known fields and are not in the schema object', () => {
    for (const name of FORBIDDEN_EXAMPLES) {
      assert.equal(isKnownField(name), false, name);
      assert.equal(Object.prototype.hasOwnProperty.call(FLOW_V3_PROFILE_SCHEMA, name), false, name);
    }
  });
});
