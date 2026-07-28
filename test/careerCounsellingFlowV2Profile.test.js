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

const EXPECTED_SLOTS = [
  'phone',
  'name',
  'language',
  'proxy',
  'source',
  'campaign',
  'rawFirstMessage',
  'createdAt',
  'botState',
  'qualification',
  'stream',
  'entryType',
  'timeline',
  'careerGoal',
  'branchInterest',
  'coreInterest',
  'coreBridgeAttempted',
  'coreBridgeClosed',
  'goalPriority',
  'budgetBand',
  'cityPref',
  'city',
  'state',
  'scholarshipFlag',
  'examType',
  'rank',
  'percentile',
  'category',
  'gender',
  'quota',
  'region',
  // Added in R4-P Stage 2 (college predictor slot-filling) — KCET/MHT-CET's
  // slot order needs it as its own gated question before category. See
  // careerCounsellingFlowV2Profile.js's own description for provenance.
  'admissionType',
  'predictorBridgeShown',
  'predictorBridgeChoice',
  'predictedColleges',
  'filtersUsed',
  'collegeOfInterest',
  'concerns',
  'hesitations',
  'shortlist',
  'comparedColleges',
  'recommendation',
  'bookingStatus',
  'temperature',
  'door',
  'isParent',
  'doorHistory',
  // Added in Phase 3 (Flow v2 router) — router-owned bookkeeping slots,
  // not tied to any B1-B7 beat. See careerCounsellingFlowV2Profile.js.
  'crisisLocked',
  'crisisHandoffId',
  'optedOut',
  'spam',
  'outOfScope',
  'conflict',
  'escalateHuman',
  'status',
  'exitReason',
  'nudgeSent',
  'nudgeSentAt',
  'hostileRedirectIssued',
];

describe('careerCounsellingFlowV2Profile schema', () => {
  test('LEAD_PROFILE_SCHEMA documents every slot from the reference list', () => {
    const keys = getSlotKeys();
    for (const slot of EXPECTED_SLOTS) {
      assert.ok(keys.includes(slot), `missing slot: ${slot}`);
    }
    assert.equal(keys.length, EXPECTED_SLOTS.length);
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
        // string/number/boolean/object: tri-state default is null
        // ("not yet determined") — see Phase 1.1 correction.
        assert.equal(profile[key], null);
      }
    }
  });

  test('boolean slots default to null (tri-state), not false', () => {
    const profile = emptyFlowV2Profile();
    for (const key of ['coreBridgeAttempted', 'coreBridgeClosed', 'predictorBridgeShown', 'scholarshipFlag', 'isParent']) {
      assert.equal(LEAD_PROFILE_SCHEMA[key].type, 'boolean');
      assert.equal(profile[key], null);
    }
  });

  test('getSlotsForBeat returns the right slots for B1-B3', () => {
    assert.deepEqual(getSlotsForBeat('entry'), ['qualification']);
    // coreInterest moved from B1 to B2 in Phase 4 — see
    // careerCounsellingFlowV2Profile.js's coreInterest description for why
    // (it's actually written by the B2.2 core-engineering fork, not B1).
    assert.deepEqual(getSlotsForBeat('B1'), ['goalPriority']);
    assert.deepEqual(getSlotsForBeat('B2'), ['branchInterest', 'coreBridgeAttempted', 'coreBridgeClosed', 'coreInterest']);
    assert.deepEqual(getSlotsForBeat('B3'), ['budgetBand', 'cityPref', 'scholarshipFlag', 'isParent']);
  });

  test('getSlotsForBeat includes the new predictor-bridge slots for B4', () => {
    const b4 = getSlotsForBeat('B4');
    assert.ok(b4.includes('predictorBridgeShown'));
    assert.ok(b4.includes('predictorBridgeChoice'));
  });

  test('getSlotsForBeat returns the corrected slots for B5/B6 (Phase 6 beat-label fix)', () => {
    // shortlist/comparedColleges/recommendation were provisionally assigned
    // to B4/B5 in Phase 1, before B1-B7 were actually built. Corrected in
    // Phase 6 once B5 · Shortlist and B6 · The Case existed for real — see
    // the BEAT LABEL CORRECTED notes on these three slots in
    // careerCounsellingFlowV2Profile.js.
    assert.deepEqual(getSlotsForBeat('B5'), ['shortlist']);
    assert.deepEqual(getSlotsForBeat('B6'), [
      'comparedColleges',
      'recommendation',
      'temperature',
      'door',
      'bookingStatus',
    ]);
  });

  test('no `stage` slot remains in the schema (lives at context.flowV2.stage instead)', () => {
    assert.equal('stage' in LEAD_PROFILE_SCHEMA, false);
  });

  test('BEAT_ORDER excludes system and covers entry through B7', () => {
    assert.deepEqual(BEAT_ORDER, ['entry', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
    assert.ok(!BEAT_ORDER.includes('system'));
  });
});
