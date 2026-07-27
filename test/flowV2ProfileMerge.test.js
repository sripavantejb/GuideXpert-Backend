'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeFlowV2Profile, dedupeArray, stableKey } = require('../services/chatbot/flowV2/flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { extractFlowV2Slots } = require('../services/chatbot/flowV2/flowV2SlotExtractor');

describe('flowV2ProfileMerge', () => {
  test('never overwrites a populated field with null/undefined from the patch', () => {
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'ECE', budgetBand: '4_6l' };
    const merged = mergeFlowV2Profile(existing, { branchInterest: null, budgetBand: undefined, cityPref: 'Pune' });
    assert.equal(merged.branchInterest, 'ECE');
    assert.equal(merged.budgetBand, '4_6l');
    assert.equal(merged.cityPref, 'Pune');
  });

  test('scalar patch value overwrites an existing populated scalar', () => {
    const existing = { ...emptyFlowV2Profile(), qualification: 'Diploma' };
    const merged = mergeFlowV2Profile(existing, { qualification: 'Graduation' });
    assert.equal(merged.qualification, 'Graduation');
  });

  test('array fields concat and dedupe rather than overwrite', () => {
    const existing = { ...emptyFlowV2Profile(), goalPriority: ['placement'] };
    const merged = mergeFlowV2Profile(existing, { goalPriority: ['placement', 'internship'] });
    assert.deepEqual(merged.goalPriority, ['placement', 'internship']);
  });

  test('doorHistory always appends, never dedupes', () => {
    const existing = { ...emptyFlowV2Profile(), doorHistory: [{ door: 'book_now', beat: 'B6', at: '2026-01-01T00:00:00Z' }] };
    const merged = mergeFlowV2Profile(existing, {
      doorHistory: [{ door: 'book_now', beat: 'B6', at: '2026-01-01T00:00:00Z' }],
    });
    assert.equal(merged.doorHistory.length, 2);
  });

  test('unknown keys not present in LEAD_PROFILE_SCHEMA are ignored', () => {
    const existing = emptyFlowV2Profile();
    const merged = mergeFlowV2Profile(existing, { notARealSlot: 'oops' });
    assert.equal('notARealSlot' in merged, false);
  });

  test('does not mutate the inputs', () => {
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'ECE' };
    const existingSnapshot = { ...existing };
    const patch = { branchInterest: 'CSE' };
    const patchSnapshot = { ...patch };
    mergeFlowV2Profile(existing, patch);
    assert.deepEqual(existing, existingSnapshot);
    assert.deepEqual(patch, patchSnapshot);
  });

  test('end-to-end: extractor patch merges additively into a populated profile', () => {
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'ECE', cityPref: 'Pune' };
    const patch = extractFlowV2Slots('12th mpc', existing);
    const merged = mergeFlowV2Profile(existing, patch);
    assert.equal(merged.qualification, 'Class 12 (MPC)');
    assert.equal(merged.branchInterest, 'ECE');
    assert.equal(merged.cityPref, 'Pune');
  });

  test('boolean tri-state: an explicit false patch value is applied, not skipped', () => {
    const existing = emptyFlowV2Profile();
    assert.equal(existing.coreBridgeAttempted, null);
    const merged = mergeFlowV2Profile(existing, { coreBridgeAttempted: false });
    assert.equal(merged.coreBridgeAttempted, false);
  });

  test('boolean tri-state: true overwrites an existing false (answer can change)', () => {
    const existing = { ...emptyFlowV2Profile(), coreBridgeAttempted: false };
    const merged = mergeFlowV2Profile(existing, { coreBridgeAttempted: true });
    assert.equal(merged.coreBridgeAttempted, true);
  });

  test('dedupeArray dedupes object arrays by stable key', () => {
    const arr = [{ collegeName: 'Plaksha' }, { collegeName: 'Plaksha' }, { collegeName: 'Krea' }];
    assert.equal(dedupeArray(arr).length, 2);
  });

  test('stableKey distinguishes primitives from objects', () => {
    assert.notEqual(stableKey('Plaksha'), stableKey({ collegeName: 'Plaksha' }));
  });
});
