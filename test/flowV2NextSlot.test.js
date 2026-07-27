'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { nextSlot } = require('../services/chatbot/flowV2/nextSlot');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

const B1_TO_B3_BEATS = ['entry', 'B1', 'B2', 'B3'];

describe('flowV2 nextSlot', () => {
  test('an empty profile asks for the entry slot (qualification) first', () => {
    assert.equal(nextSlot(emptyFlowV2Profile()), 'qualification');
  });

  test('walks B1-B3 in declared order, including boolean slots which now gate on null', () => {
    const profile = emptyFlowV2Profile();
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'qualification');

    profile.qualification = 'Class 12 (MPC)';
    // coreInterest moved from B1 to B2 in Phase 4 (it's actually written by
    // the B2.2 core-engineering fork, not B1 · Goal) — B1 now has exactly
    // one slot, goalPriority.
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'goalPriority');

    profile.goalPriority = ['placement'];
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'branchInterest');

    profile.branchInterest = 'CSE';
    // coreBridgeAttempted/coreBridgeClosed are boolean, still null (unanswered) -> they now gate
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'coreBridgeAttempted');

    profile.coreBridgeAttempted = false; // a real "no" answer, not a skip
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'coreBridgeClosed');

    profile.coreBridgeClosed = false;
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'coreInterest');

    profile.coreInterest = 'AI';
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'budgetBand');

    profile.budgetBand = '2_4l';
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'cityPref');

    profile.cityPref = 'Hyderabad';
    // scholarshipFlag / isParent are boolean and still null -> they now gate too
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'scholarshipFlag');

    profile.scholarshipFlag = false;
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'isParent');

    profile.isParent = false;
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), null);
  });

  test('returns null once all B1-B3 slots (including booleans) are answered', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      coreInterest: 'AI',
      goalPriority: ['placement'],
      branchInterest: 'CSE',
      coreBridgeAttempted: false,
      coreBridgeClosed: false,
      budgetBand: '2_4l',
      cityPref: 'Hyderabad',
      scholarshipFlag: false,
      isParent: false,
    };
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), null);
  });

  test('a boolean slot still left at its null default blocks advancement, even if every other B1-B3 slot is filled', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      coreInterest: 'AI',
      goalPriority: ['placement'],
      branchInterest: 'CSE',
      coreBridgeAttempted: false,
      coreBridgeClosed: false,
      budgetBand: '2_4l',
      cityPref: 'Hyderabad',
      // scholarshipFlag / isParent intentionally left at their null default
    };
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), 'scholarshipFlag');
  });

  test('an explicit false answer is treated as determined, not as "never asked"', () => {
    const profile = { ...emptyFlowV2Profile(), qualification: 'Diploma', coreInterest: 'AI', goalPriority: ['placement'] };
    profile.branchInterest = 'CSE';
    profile.coreBridgeAttempted = false;
    profile.coreBridgeClosed = false;
    profile.budgetBand = '2_4l';
    profile.cityPref = 'Hyderabad';
    profile.scholarshipFlag = false;
    profile.isParent = false;
    assert.equal(nextSlot(profile, { beats: B1_TO_B3_BEATS }), null);
  });

  test('without the beats option, a fully-answered B1-B3 profile continues into B4', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      coreInterest: 'AI',
      goalPriority: ['placement'],
      branchInterest: 'CSE',
      coreBridgeAttempted: false,
      coreBridgeClosed: false,
      budgetBand: '2_4l',
      cityPref: 'Hyderabad',
      scholarshipFlag: false,
      isParent: false,
    };
    // Full BEAT_ORDER walk (default) continues past B3 into B4, since B4-B7
    // slots are part of the schema but not yet filled — this is expected:
    // B4-B7 conversational requiredness is not finalized in this phase.
    assert.equal(nextSlot(profile), 'examType');
  });

  test('no `stage` slot exists to gate on (removed from the schema)', () => {
    const profile = emptyFlowV2Profile();
    assert.equal('stage' in profile, false);
  });
});
