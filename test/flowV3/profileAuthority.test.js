'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { emptyFlowV3Profile } = require('../../constants/flowV3/flowV3LeadProfileSchema');
const { deriveAcademicYear } = require('../../constants/flowV3/flowV3SlotMetaContract');
const authority = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileAuthority');
const derived = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileDerived');

const NOW = new Date('2026-07-30T10:00:00.000Z');
const CURRENT_YEAR = deriveAcademicYear(NOW);

function profileWith(overrides = {}) {
  return { ...emptyFlowV3Profile(), ...overrides };
}

describe('RULE A — an inferred slot still counts as EMPTY', () => {
  test('an inferred value does not satisfy the next question', () => {
    const profile = profileWith({ budgetBand: 'under_2l' });
    const slotMeta = {
      budgetBand: { source: 'inferred', confidence: 0.6, verbatimQuote: 'money is tight', turnId: 't1', setAt: NOW },
    };

    const verdict = authority.isEmptyForNextQuestion(profile, slotMeta, 'budgetBand', { now: NOW });
    assert.equal(verdict.empty, true);
    assert.equal(verdict.reason, authority.EMPTY_REASONS.INFERRED_ONLY);
    assert.equal(authority.canSatisfyNextQuestion(profile, slotMeta, 'budgetBand', { now: NOW }), false);
  });

  test('the same value captured as typed does satisfy it', () => {
    const profile = profileWith({ budgetBand: 'under_2l' });
    const slotMeta = {
      budgetBand: { source: 'typed', verbatimQuote: 'under 2 lakhs', turnId: 't1', setAt: NOW },
    };
    assert.equal(authority.canSatisfyNextQuestion(profile, slotMeta, 'budgetBand', { now: NOW }), true);
    assert.equal(authority.isAuthoritativeValue(slotMeta, 'budgetBand'), true);
  });

  test('an unset slot is empty regardless of meta', () => {
    const verdict = authority.isEmptyForNextQuestion(profileWith(), {}, 'budgetBand', { now: NOW });
    assert.equal(verdict.reason, authority.EMPTY_REASONS.UNSET);
  });

  test('fields the contract marks Auth ✗ are never authoritative, whatever the source', () => {
    const profile = profileWith({ locality: 'tier2', parentInvolvement: 'high' });
    const slotMeta = {
      locality: { source: 'typed', verbatimQuote: 'I live in a small town', turnId: 't1', setAt: NOW },
      parentInvolvement: { source: 'counsellor', turnId: 't1', setAt: NOW },
    };
    assert.equal(authority.isAuthoritativeValue(slotMeta, 'locality'), false);
    assert.equal(authority.isInferredValue(slotMeta, 'parentInvolvement'), true);
  });
});

describe('§5.2 staleness — a stale volatile slot is EMPTY', () => {
  test('last year\'s rank must be re-confirmed', () => {
    const profile = profileWith({ rank: 15000 });
    const slotMeta = {
      rank: {
        source: 'extracted',
        verbatimQuote: 'my rank is 15000',
        turnId: 't1',
        setAt: new Date('2025-06-01T00:00:00.000Z'),
        academicYear: CURRENT_YEAR - 1,
      },
    };
    const verdict = authority.isEmptyForNextQuestion(profile, slotMeta, 'rank', { now: NOW });
    assert.equal(verdict.empty, true);
    assert.equal(verdict.reason, authority.EMPTY_REASONS.STALE_VOLATILE);
  });

  test('a current-year rank is usable', () => {
    const profile = profileWith({ rank: 15000 });
    const slotMeta = {
      rank: { source: 'extracted', verbatimQuote: 'rank 15000', turnId: 't1', setAt: NOW, academicYear: CURRENT_YEAR },
    };
    assert.equal(authority.canSatisfyNextQuestion(profile, slotMeta, 'rank', { now: NOW }), true);
  });

  test('a volatile slot with no recorded academic year is treated as stale', () => {
    const profile = profileWith({ rank: 15000 });
    const slotMeta = { rank: { source: 'extracted', verbatimQuote: 'rank', turnId: 't1', setAt: NOW } };
    assert.equal(
      authority.evaluateStaleness('rank', slotMeta.rank, { now: NOW }).stale,
      true
    );
  });

  test('stable slots never go stale; soft slots go stale after 180d but stay usable', () => {
    const oldSetAt = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000);
    assert.equal(authority.evaluateStaleness('name', { setAt: oldSetAt }, { now: NOW }).stale, false);

    const soft = authority.evaluateStaleness('budgetBand', { setAt: oldSetAt }, { now: NOW });
    assert.equal(soft.stale, true);
    assert.equal(soft.kind, 'soft');

    const profile = profileWith({ budgetBand: 'under_2l' });
    const slotMeta = { budgetBand: { source: 'button', turnId: 't1', setAt: oldSetAt } };
    assert.equal(
      authority.isEmptyForNextQuestion(profile, slotMeta, 'budgetBand', { now: NOW }).empty,
      false,
      'soft-stale is confirmed in passing, not re-asked cold'
    );
  });
});

describe('S-1 — inferred or stale values never reach the predictor', () => {
  const predictorFields = ['examType', 'rank', 'category', 'gender'];

  test('a complete authoritative current-year profile passes', () => {
    const profile = profileWith({ examType: 'AP_EAMCET', rank: 15000, category: 'OC', gender: 'male' });
    const entry = (source) => ({ source, verbatimQuote: 'x', turnId: 't1', setAt: NOW, academicYear: CURRENT_YEAR });
    const slotMeta = {
      examType: entry('button'),
      rank: entry('extracted'),
      category: entry('button'),
      gender: entry('button'),
    };
    const result = authority.checkPredictorInputs(profile, slotMeta, predictorFields, { now: NOW });
    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  test('an inferred category is refused, and so is a missing one', () => {
    const profile = profileWith({ examType: 'AP_EAMCET', rank: 15000, category: 'OC' });
    const slotMeta = {
      examType: { source: 'button', turnId: 't1', setAt: NOW, academicYear: CURRENT_YEAR },
      rank: { source: 'extracted', verbatimQuote: 'r', turnId: 't1', setAt: NOW, academicYear: CURRENT_YEAR },
      category: { source: 'inferred', confidence: 0.8, verbatimQuote: 'general I think', turnId: 't1', setAt: NOW, academicYear: CURRENT_YEAR },
    };
    const result = authority.checkPredictorInputs(profile, slotMeta, predictorFields, { now: NOW });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.sort((a, b) => a.field.localeCompare(b.field)),
      [
        { field: 'category', reason: authority.USE_VIOLATIONS.INFERRED },
        { field: 'gender', reason: authority.USE_VIOLATIONS.MISSING },
      ]
    );
  });

  test('a recommendation cannot be gated on an inferred value', () => {
    const profile = profileWith({ goalPriority: ['placements'] });
    const inferred = {
      goalPriority: { source: 'inferred', confidence: 0.5, verbatimQuote: 'job matters', turnId: 't1', setAt: NOW },
    };
    assert.equal(authority.canGateRecommendation(profile, inferred, ['goalPriority'], { now: NOW }), false);

    const stated = { goalPriority: { source: 'button', turnId: 't1', setAt: NOW } };
    assert.equal(authority.canGateRecommendation(profile, stated, ['goalPriority'], { now: NOW }), true);
  });

  test('stripInferredValues removes inferred values before a tool sees them', () => {
    const profile = profileWith({ rank: 15000, budgetBand: 'under_2l', locality: 'metro' });
    const slotMeta = {
      rank: { source: 'extracted', verbatimQuote: 'r', turnId: 't1', setAt: NOW, academicYear: CURRENT_YEAR },
      budgetBand: { source: 'inferred', confidence: 0.4, verbatimQuote: 'tight', turnId: 't1', setAt: NOW },
    };
    const safe = authority.stripInferredValues(profile, slotMeta);
    assert.equal(safe.rank, 15000);
    assert.equal(safe.budgetBand, null);
    assert.equal(safe.locality, null, 'Auth ✗ fields are stripped too');
  });
});

describe('§4 counsellor brief inputs — stated and inferred stay separate', () => {
  test('partition keeps quotes and confidence with the inferred side', () => {
    const profile = profileWith({ name: 'Asha', goalClarity: 'exploring' });
    const slotMeta = {
      name: { source: 'typed', verbatimQuote: 'Asha', turnId: 't1', setAt: NOW },
      goalClarity: { source: 'inferred', confidence: 0.55, verbatimQuote: 'still figuring out', turnId: 't2', setAt: NOW },
    };
    const { stated, inferred } = authority.partitionStatedVsInferred(profile, slotMeta);

    assert.deepEqual(stated.map((s) => s.field), ['name']);
    assert.deepEqual(inferred.map((s) => s.field), ['goalClarity']);
    assert.equal(inferred[0].confidence, 0.55);
    assert.equal(inferred[0].verbatimQuote, 'still figuring out');
  });
});

describe('derived reads for the live/contract type conflicts', () => {
  test('coreInterest boolean is derived tri-state, with no companion field', () => {
    assert.equal(derived.deriveCoreInterest(profileWith()), null);
    assert.equal(derived.deriveCoreInterest(profileWith({ coreInterest: 'mechanical' })), true);
    assert.equal(derived.deriveCoreInterest(profileWith({ coreInterest: 'none' })), false);
    assert.equal(derived.getCoreInterestField(profileWith({ coreInterest: 'civil' })), 'civil');
  });

  test('goalPriority scalar semantics come from element 0', () => {
    assert.equal(derived.getGoalPriorityScalar(profileWith()), null);
    assert.equal(
      derived.getGoalPriorityScalar(profileWith({ goalPriority: ['placements', 'fees'] })),
      'placements'
    );
    assert.deepEqual(
      derived.getGoalPriorityList(profileWith({ goalPriority: ['placements', 'fees'] })),
      ['placements', 'fees']
    );
  });

  test('companion accessors prefer the array and fall back to the legacy string', () => {
    assert.deepEqual(
      derived.getCollegeOfInterestList(profileWith({ collegeOfInterestList: ['Kalvium'] })),
      ['Kalvium']
    );
    assert.deepEqual(
      derived.getCollegeOfInterestList(profileWith({ collegeOfInterest: 'Plaksha' })),
      ['Plaksha']
    );
    assert.equal(
      derived.getCollegeOfInterestScalar(profileWith({ collegeOfInterestList: ['A', 'B'] })),
      'A, B'
    );
  });
});
