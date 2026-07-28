'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SLOT_TYPES,
  BEAT_ORDER,
  LEAD_PROFILE_SCHEMA,
  getSlotKeys,
  getSlotsForBeat,
  emptyFlowV2Profile,
} = require('../constants/careerCounsellingFlowV2Profile');

const EXPECTED_NEW_SLOTS = [
  'goal',
  'interests',
  'interestCluster',
  'checklistSent',
  'permissionRecommend',
  'frameSent',
  'followupsSent',
  'bookingFollowup',
  'callbackNumber',
  'honestPassFired',
  'fitCollege',
  'fitReason',
  'shortlistAskDeclined',
  'niatInterest',
];

describe('careerCounsellingFlowV2Profile schema (V3)', () => {
  test('BEAT_ORDER is V3 B1–B10 including B6.5', () => {
    assert.deepEqual(BEAT_ORDER, [
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
      'B6',
      'B6.5',
      'B7',
      'B8',
      'B9',
      'B10',
    ]);
    assert.ok(!BEAT_ORDER.includes('system'));
    assert.ok(!BEAT_ORDER.includes('entry'));
  });

  test('V3 delivery / fit / booking slots exist', () => {
    const keys = getSlotKeys();
    for (const slot of EXPECTED_NEW_SLOTS) {
      assert.ok(keys.includes(slot), `missing slot: ${slot}`);
    }
  });

  test('every slot has a valid type, writeBeats, readBeats, description', () => {
    for (const key of getSlotKeys()) {
      const def = LEAD_PROFILE_SCHEMA[key];
      assert.ok(SLOT_TYPES.includes(def.type), `${key} has invalid type ${def.type}`);
      assert.ok(Array.isArray(def.writeBeats) && def.writeBeats.length > 0, `${key} missing writeBeats`);
      assert.ok(Array.isArray(def.readBeats) && def.readBeats.length > 0, `${key} missing readBeats`);
      assert.ok(typeof def.description === 'string' && def.description.length > 0, `${key} missing description`);
    }
  });

  test('emptyFlowV2Profile() returns all documented slots, correctly typed', () => {
    const profile = emptyFlowV2Profile();
    for (const key of getSlotKeys()) {
      const def = LEAD_PROFILE_SCHEMA[key];
      assert.ok(key in profile, `profile missing key ${key}`);
      if (def.type === 'array') {
        assert.deepEqual(profile[key], []);
      } else {
        assert.equal(profile[key], null);
      }
    }
  });

  test('boolean slots default to null (tri-state), not false', () => {
    const profile = emptyFlowV2Profile();
    for (const key of [
      'coreBridgeAttempted',
      'coreBridgeClosed',
      'predictorBridgeShown',
      'scholarshipFlag',
      'isParent',
      'checklistSent',
      'permissionRecommend',
    ]) {
      assert.equal(LEAD_PROFILE_SCHEMA[key].type, 'boolean');
      assert.equal(profile[key], null);
    }
  });

  test('getSlotsForBeat maps V3 askable ownership', () => {
    assert.ok(getSlotsForBeat('B1').includes('qualification'));
    assert.ok(getSlotsForBeat('B2').includes('goal'));
    assert.ok(getSlotsForBeat('B3').includes('interests'));
    assert.ok(getSlotsForBeat('B4').includes('goalPriority'));
    assert.ok(getSlotsForBeat('B5').includes('checklistSent'));
    assert.ok(getSlotsForBeat('B6').includes('permissionRecommend'));
    assert.ok(getSlotsForBeat('B6.5').includes('budgetBand'));
    assert.ok(getSlotsForBeat('B6.5').includes('cityPref'));
    assert.ok(getSlotsForBeat('B8').includes('shortlist'));
  });

  test('no `stage` slot remains in the schema (lives at context.flowV2.stage instead)', () => {
    assert.equal('stage' in LEAD_PROFILE_SCHEMA, false);
  });
});
