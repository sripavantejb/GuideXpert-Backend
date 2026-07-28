'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { nextSlot, isEmptyForGating } = require('../services/chatbot/flowV2/nextSlot');
const { LEAD_PROFILE_SCHEMA } = require('../constants/careerCounsellingFlowV2Profile');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

const B1_TO_B3_BEATS = ['entry', 'B1', 'B2', 'B3'];

describe('flowV2 nextSlot', () => {
  test('an empty profile asks for the entry slot (qualification) first', () => {
    assert.equal(nextSlot(emptyFlowV2Profile()), 'qualification');
  });

  test('walks only the five declared conversational questions in B1-B3 order', () => {
    const profile = emptyFlowV2Profile();
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'qualification');

    profile.qualification = 'Class 12 (MPC)';
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'goalPriority');

    profile.goalPriority = ['placement'];
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'branchInterest');

    profile.branchInterest = 'CSE';
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'budgetBand');

    profile.budgetBand = '2_4l';
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'cityPref');

    profile.cityPref = 'Hyderabad';
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), null);
  });

  test('derived/optional metadata never becomes a phantom question', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      goalPriority: ['placement'],
      branchInterest: 'CSE',
      budgetBand: '2_4l',
      cityPref: 'Hyderabad',
    };
    assert.equal(profile.coreBridgeAttempted, null);
    assert.equal(profile.scholarshipFlag, null);
    assert.equal(profile.isParent, null);
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), null);
  });

  test('tri-state helper still treats explicit false as known if a future boolean question is declared askable', () => {
    assert.equal(isEmptyForGating({ type: 'boolean' }, null), true);
    assert.equal(isEmptyForGating({ type: 'boolean' }, false), false);
  });

  test('without beats option, completed B1-B3 has no phantom B4-B7 output questions', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      goalPriority: ['placement'],
      branchInterest: 'CSE',
      budgetBand: '2_4l',
      cityPref: 'Hyderabad',
    };
    assert.equal(nextSlot(profile), null);
  });

  test('the registry explicitly marks only actual generic-flow questions as askable', () => {
    const askable = Object.entries(LEAD_PROFILE_SCHEMA)
      .filter(([, def]) => def.askable === true)
      .map(([key]) => key);
    assert.deepEqual(askable, ['qualification', 'goalPriority', 'branchInterest', 'budgetBand', 'cityPref']);
  });

  test('no `stage` slot exists to gate on (removed from the schema)', () => {
    const profile = emptyFlowV2Profile();
    assert.equal('stage' in profile, false);
  });
});
