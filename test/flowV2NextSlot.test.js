'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { nextSlot, isEmptyForGating } = require('../services/chatbot/flowV2/nextSlot');
const { LEAD_PROFILE_SCHEMA } = require('../constants/careerCounsellingFlowV2Profile');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

const FRONT_HALF_BEATS = ['B1', 'B2', 'B3', 'B4'];

describe('flowV2 nextSlot (V3)', () => {
  test('an empty profile asks for B1 qualification first', () => {
    assert.equal(nextSlot(emptyFlowV2Profile()), 'qualification');
  });

  test('walks V3 front-half askable slots in order', () => {
    const profile = emptyFlowV2Profile();
    assert.equal(nextSlot(profile, { beats: FRONT_HALF_BEATS }), 'qualification');

    profile.qualification = 'Class 12 (MPC)';
    assert.equal(nextSlot(profile, { beats: FRONT_HALF_BEATS }), 'goal');

    profile.goal = 'branch_fit';
    assert.equal(nextSlot(profile, { beats: FRONT_HALF_BEATS }), 'interests');

    profile.interests = ['computers'];
    assert.equal(nextSlot(profile, { beats: FRONT_HALF_BEATS }), 'goalPriority');

    profile.goalPriority = ['placements'];
    assert.equal(nextSlot(profile, { beats: FRONT_HALF_BEATS }), null);
  });

  test('constraints askables live at B6.5, not the front half', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      goal: 'college_fit',
      interests: ['ai'],
      goalPriority: ['placements'],
    };
    assert.equal(nextSlot(profile, { beats: FRONT_HALF_BEATS }), null);
    assert.equal(nextSlot(profile, { beats: ['B6.5'] }), 'budgetBand');
    profile.budgetBand = '2_5l';
    assert.equal(nextSlot(profile, { beats: ['B6.5'] }), 'cityPref');
  });

  test('tri-state helper still treats explicit false as known', () => {
    assert.equal(isEmptyForGating({ type: 'boolean' }, null), true);
    assert.equal(isEmptyForGating({ type: 'boolean' }, false), false);
  });

  test('askable registry matches V3 conversational questions', () => {
    const askable = Object.entries(LEAD_PROFILE_SCHEMA)
      .filter(([, def]) => def.askable === true)
      .map(([key]) => key);
    assert.deepEqual(askable, [
      'qualification',
      'goal',
      'goalPriority',
      'interests',
      'budgetBand',
      'cityPref',
    ]);
  });

  test('no `stage` slot exists to gate on', () => {
    const profile = emptyFlowV2Profile();
    assert.equal('stage' in profile, false);
  });
});
