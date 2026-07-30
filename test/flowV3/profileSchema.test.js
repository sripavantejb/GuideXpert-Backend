'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  LEAD_PROFILE_SCHEMA,
  getSlotKeys,
} = require('../../constants/careerCounsellingFlowV2Profile');

const schema = require('../../constants/flowV3/flowV3LeadProfileSchema');

describe('Flow V3 lead profile schema — extends, never replaces', () => {
  test('retains all 75 live slot names', () => {
    const liveKeys = getSlotKeys();
    assert.equal(liveKeys.length, 75);
    assert.equal(schema.LEGACY_SLOT_KEYS.length, 75);
    for (const key of liveKeys) {
      assert.ok(schema.isKnownField(key), `${key} missing from V3 schema`);
    }
  });

  test('retains all 75 live slot TYPES exactly', () => {
    for (const key of getSlotKeys()) {
      assert.equal(
        schema.FLOW_V3_PROFILE_SCHEMA[key].type,
        LEAD_PROFILE_SCHEMA[key].type,
        `${key} type drifted from the live schema`
      );
    }
  });

  test('preserves live askable / writeBeats / readBeats metadata', () => {
    for (const key of getSlotKeys()) {
      const live = LEAD_PROFILE_SCHEMA[key];
      const v3 = schema.FLOW_V3_PROFILE_SCHEMA[key];
      assert.deepEqual(v3.writeBeats, live.writeBeats, `${key} writeBeats drifted`);
      assert.deepEqual(v3.readBeats, live.readBeats, `${key} readBeats drifted`);
      assert.equal(v3.askable, live.askable, `${key} askable drifted`);
      assert.equal(v3.legacy, true);
    }
  });

  test('no new field collides with a legacy slot name', () => {
    for (const key of schema.V3_NEW_FIELD_KEYS) {
      assert.equal(key in LEAD_PROFILE_SCHEMA, false, `${key} collides with a legacy slot`);
    }
  });

  test('adds the five structured arrays plus leadStageHistory', () => {
    for (const field of [
      'examResults',
      'objections',
      'competitorsMentioned',
      'shownArtifacts',
      'counsellorCorrections',
    ]) {
      assert.ok(schema.isStructuredArrayField(field), `${field} must be a structured array`);
      assert.equal(schema.FLOW_V3_PROFILE_SCHEMA[field].type, 'array');
    }
    assert.equal(schema.getStructuredArraySpec('leadStageHistory').appendOnly, true);
  });

  test('every contract group A-K is represented', () => {
    const groups = new Set(schema.ALL_FIELD_KEYS.map((key) => schema.getFieldGroup(key)));
    for (const group of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      assert.ok(groups.has(group), `no field classified in group ${group}`);
    }
  });

  test('emptyFlowV3Profile defaults arrays to [] and everything else to null', () => {
    const profile = schema.emptyFlowV3Profile();
    assert.equal(Object.keys(profile).length, schema.ALL_FIELD_KEYS.length);
    for (const key of schema.ALL_FIELD_KEYS) {
      const { type } = schema.FLOW_V3_PROFILE_SCHEMA[key];
      if (type === 'array') assert.deepEqual(profile[key], [], `${key} should default to []`);
      else assert.equal(profile[key], null, `${key} should default to null`);
    }
  });

  test('companions exist only for the two string/array conflicts', () => {
    assert.deepEqual(schema.COMPANION_FIELDS, {
      parentConstraintsList: 'parentConstraints',
      collegeOfInterestList: 'collegeOfInterest',
    });
    // Resolved decision: no companion for coreInterest or goalPriority.
    assert.equal(schema.isKnownField('coreInterestBool'), false);
    assert.equal(schema.isKnownField('goalPriorityScalar'), false);
    assert.ok(schema.COMPANION_DELIBERATELY_OMITTED.coreInterest);
    assert.ok(schema.COMPANION_DELIBERATELY_OMITTED.goalPriority);
  });

  test('§3 DO NOT BUILD categories are absent from the schema', () => {
    for (const key of schema.ALL_FIELD_KEYS) {
      for (const pattern of schema.EXCLUDED_FIELD_NAME_PATTERNS) {
        assert.equal(pattern.test(key), false, `${key} matches excluded pattern ${pattern}`);
      }
    }
    assert.ok(schema.EXCLUDED_FIELD_CATEGORIES.length >= 6);
  });

  test('sensitivity tiers classify the protected and volunteered fields', () => {
    for (const field of ['category', 'gender', 'isMinor', 'genderConstraint', 'firstGenerationCollege']) {
      assert.equal(schema.getFieldTier(field), 3, `${field} must be Tier 3`);
    }
    assert.equal(schema.getFieldTier('accessibilityNeeds'), 4);
    assert.ok(schema.CRISIS_RECORD_FIELDS.includes('crisisLocked'));
    assert.deepEqual(schema.TIER3_NESTED_PATHS, ['examResults.category', 'examResults.gender']);
  });

  test('staleness classes follow §5.2', () => {
    for (const field of ['rank', 'percentile', 'examType', 'category', 'quota', 'region', 'admissionType']) {
      assert.equal(schema.isVolatileField(field), true, `${field} must be volatile`);
    }
    for (const field of ['name', 'qualification', 'stream']) {
      assert.equal(schema.getStalenessClass(field), 'S', `${field} must be stable`);
    }
    for (const field of ['budgetBand', 'cityPref', 'goal', 'interests', 'goalPriority']) {
      assert.equal(schema.isSoftField(field), true, `${field} must be soft`);
    }
    assert.equal(schema.SOFT_STALENESS_DAYS, 180);
  });

  test('non-authoritative fields are exactly the contract Auth ✗ rows', () => {
    assert.deepEqual(
      [...schema.NON_AUTHORITATIVE_FIELDS].sort(),
      ['decisionMakerPresent', 'goalClarity', 'locality', 'parentInvolvement'].sort()
    );
  });

  test('category and gender may never be inferred', () => {
    for (const field of ['category', 'gender', 'isMinor', 'firstGenerationCollege', 'accessibilityNeeds']) {
      assert.equal(schema.isNeverInferredField(field), true, `${field} must be authoritative-only`);
    }
    assert.deepEqual(schema.NEVER_INFERRED_NESTED_PATHS, ['examResults.category', 'examResults.gender']);
  });

  test('LLM allowlist blocks group H/I, code-owned J/K, consent, Tier 3/4', () => {
    for (const field of [
      'turnCount',
      'typedRatio',
      'beatsSkipped',
      'leadStage',
      'leadStageHistory',
      'bookingStatus',
      'crisisLocked',
      'shownArtifacts',
      'counsellorCorrections',
      'enrolledCollege',
      'consentAt',
      'consentVersion',
      'isMinor',
      'category',
      'gender',
      'genderConstraint',
      'firstGenerationCollege',
      'accessibilityNeeds',
      'shortlist',
      'predictedColleges',
    ]) {
      assert.equal(schema.isLlmWritableField(field), false, `LLM must not write ${field}`);
    }
  });

  test('LLM allowlist still permits content fields and examResults', () => {
    for (const field of [
      'name',
      'qualification',
      'goal',
      'goalPriority',
      'interests',
      'budgetBand',
      'examResults',
      'objections',
      'competitorsMentioned',
      'decisionMaker',
      'parentConstraintsList',
      'collegeOfInterestList',
      'goalClarity',
      'locality',
    ]) {
      assert.equal(schema.isLlmWritableField(field), true, `LLM should be able to write ${field}`);
    }
  });

  test('B-6 load-time allowlist keeps examResults.category and .gender blocked', () => {
    assert.ok(schema.LLM_BLOCKED_NESTED_PATHS.includes('examResults.category'));
    assert.ok(schema.LLM_BLOCKED_NESTED_PATHS.includes('examResults.gender'));
    assert.equal(schema.canLlmWriteField('examResults.category').allowed, false);
    assert.equal(schema.canLlmWriteField('examResults.gender').allowed, false);
    assert.equal(schema.canLlmWriteField('category').allowed, false);
    assert.equal(schema.canLlmWriteField('gender').allowed, false);

    // The IIFE that throws on leak must still be in the module source — if an
    // agent deletes it the next load of a leaked schema would succeed silently.
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../../constants/flowV3/flowV3LeadProfileSchema'), 'utf8');
    assert.match(src, /assertAllowlistContract/);
    assert.match(src, /allowlist leak/);
    assert.match(src, /examResults\.category/);
    assert.match(src, /examResults\.gender/);
  });

  test('consent fields are write-blocked on every channel, pending the open items', () => {
    for (const field of ['consentAt', 'consentVersion', 'isMinor']) {
      assert.equal(schema.isSystemWriteBlockedField(field), true);
      assert.ok(schema.FLOW_V3_PROFILE_SCHEMA[field].pending, `${field} must carry a TODO marker`);
      assert.equal(schema.FLOW_V3_PROFILE_SCHEMA[field].type === 'date' || schema.FLOW_V3_PROFILE_SCHEMA[field].type === 'string' || schema.FLOW_V3_PROFILE_SCHEMA[field].type === 'boolean', true);
    }
  });
});
