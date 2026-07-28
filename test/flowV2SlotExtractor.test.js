'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { extractFlowV2Slots, extractBudgetBand } = require('../services/chatbot/flowV2/flowV2SlotExtractor');

describe('flowV2SlotExtractor', () => {
  test('extracts all four slots from a multi-slot message in one pass', () => {
    const patch = extractFlowV2Slots('im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only', {});
    assert.equal(patch.qualification, '12th Completed (PCM)');
    assert.equal(patch.branchInterest, 'CSE');
    assert.equal(patch.budgetBand, '2_4l');
    assert.equal(patch.cityPref, 'Hyderabad');
  });

  test('extracts a single slot without inventing unrelated ones', () => {
    const patch = extractFlowV2Slots('12th mpc', {});
    assert.deepEqual(Object.keys(patch), ['qualification']);
    assert.equal(patch.qualification, '12th Completed (PCM)');
  });

  test('extracting a single slot never nulls out unrelated existing profile fields', () => {
    const existingProfile = { branchInterest: 'ECE', budgetBand: '4_6l', cityPref: 'Pune' };
    const patch = extractFlowV2Slots('12th mpc', existingProfile);
    assert.equal('branchInterest' in patch, false);
    assert.equal('budgetBand' in patch, false);
    assert.equal('cityPref' in patch, false);
    // sanity: unrelated fields on the caller's profile object are untouched (pure function)
    assert.equal(existingProfile.branchInterest, 'ECE');
  });

  test('never emits an explicit null/undefined for a slot it did not find', () => {
    const patch = extractFlowV2Slots('hello there', {});
    for (const value of Object.values(patch)) {
      assert.notEqual(value, null);
      assert.notEqual(value, undefined);
    }
  });

  test('rank extraction requires an explicit rank/AIR keyword (no false positive on budget figures)', () => {
    const patch = extractFlowV2Slots('budget around 3 lakhs', {});
    assert.equal('rank' in patch, false);
    const withRank = extractFlowV2Slots('my rank is 18453', {});
    assert.equal(withRank.rank, 18453);
  });

  test('extracts examType, category, and gender from a shortlisting-style message', () => {
    const patch = extractFlowV2Slots('I wrote AP EAMCET, OC category, male', {});
    assert.equal(patch.examType, 'AP_EAMCET');
    assert.equal(patch.category, 'OC');
    assert.equal(patch.gender, 'male');
  });

  test('goalPriority extracts multiple mentioned priorities as a deduped array', () => {
    const patch = extractFlowV2Slots('placements and internships matter most, also affordable fees', {});
    assert.ok(Array.isArray(patch.goalPriority));
    assert.ok(patch.goalPriority.includes('placement'));
    assert.ok(patch.goalPriority.includes('internship'));
    assert.ok(patch.goalPriority.includes('affordable'));
  });

  describe('extractBudgetBand — KNOWN BUG: range / open-ended free text (found in Phase 5, not fixed)', () => {
    // This describe block documents CURRENT (WRONG) behavior on purpose —
    // see the KNOWN BUG comment directly above extractBudgetBand() in
    // flowV2SlotExtractor.js for full detail. It exists so R3/R4-C (the
    // two live callers with no B3-style tap-recognizer fallback) don't
    // silently reintroduce the same confidently-wrong band without
    // anyone noticing, and so whoever eventually fixes this gets an
    // immediate, specific test failure here forcing them to update this
    // block rather than it going stale silently.
    test('range statements collapse to a single (wrong) band instead of failing safely to null', () => {
      assert.equal(extractBudgetBand('between 2 and 5 lakhs'), '4_6l'); // should NOT confidently resolve to a single band
      assert.equal(extractBudgetBand('2-5 lakhs'), '4_6l');
      assert.equal(extractBudgetBand('2 to 5 lakhs'), '4_6l');
    });

    test('open-ended qualifiers ("or more" / "more than") are silently dropped, producing a closed band', () => {
      assert.equal(extractBudgetBand('5 lakhs or more'), '4_6l'); // should NOT be bucketed as a closed 4-6L band
      assert.equal(extractBudgetBand('more than 5 lakhs'), '4_6l');
    });

    test('the one case that DOES fail safely today — only incidental, not by design (bare "+" breaks the digit/unit-word regex boundary)', () => {
      assert.equal(extractBudgetBand('5+ lakhs'), null);
    });
  });

  test('scholarshipFlag and isParent are only ever true or absent, never explicit false', () => {
    const noMention = extractFlowV2Slots('I want to study CSE', {});
    assert.equal('scholarshipFlag' in noMention, false);
    assert.equal('isParent' in noMention, false);

    const mentioned = extractFlowV2Slots('I need a scholarship, and I am asking as a parent', {});
    assert.equal(mentioned.scholarshipFlag, true);
    assert.equal(mentioned.isParent, true);
  });
});
