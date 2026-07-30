'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { emptyFlowV3Profile } = require('../../constants/flowV3/flowV3LeadProfileSchema');
const { mergeFlowV2Profile } = require('../../services/chatbot/flowV2/flowV2ProfileMerge');
const {
  mergeFlowV3Profile,
  mergeStructuredArray,
  MERGE_DROP_REASONS,
  coerceDate,
} = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileMerge');

function baseProfile(overrides = {}) {
  return { ...emptyFlowV3Profile(), ...overrides };
}

describe('Flow V3 merge — legacy delegation', () => {
  test('flat legacy fields produce exactly the frozen merge result', () => {
    const existing = baseProfile({ interests: ['ai'], budgetBand: 'under_2l' });
    const patch = { interests: ['robotics', 'ai'], budgetBand: '2_5l', qualification: 'Class 12' };

    const v3 = mergeFlowV3Profile(existing, patch, { mirrors: false }).profile;
    const v2 = mergeFlowV2Profile(existing, patch);

    for (const key of Object.keys(patch)) {
      assert.deepEqual(v3[key], v2[key], `${key} diverged from the frozen merge`);
    }
    assert.deepEqual(v3.interests, ['ai', 'robotics']);
  });

  test('null and undefined never clobber an existing value', () => {
    const existing = baseProfile({ name: 'Asha', budgetAmount: 250000 });
    const result = mergeFlowV3Profile(existing, { name: null, budgetAmount: undefined });
    assert.equal(result.profile.name, 'Asha');
    assert.equal(result.profile.budgetAmount, 250000);
    assert.ok(result.dropped.some((d) => d.field === 'name' && d.reason === MERGE_DROP_REASONS.NULL_VALUE));
  });

  test('unknown keys are dropped, not written', () => {
    const result = mergeFlowV3Profile(baseProfile(), { notASlot: 'x', desperationScore: 0.9 });
    assert.equal('notASlot' in result.profile, false);
    assert.equal('desperationScore' in result.profile, false);
    assert.equal(result.dropped.length, 2);
  });

  test('doorHistory stays append-only via the frozen merge', () => {
    const existing = baseProfile({ doorHistory: [{ turn: 1 }] });
    const result = mergeFlowV3Profile(existing, { doorHistory: [{ turn: 1 }, { turn: 2 }] });
    assert.equal(result.profile.doorHistory.length, 3);
  });
});

describe('Flow V3 merge — new and nested fields', () => {
  test('scalar arrays concat + dedupe', () => {
    const existing = baseProfile({ subjectStrengths: ['maths'] });
    const result = mergeFlowV3Profile(existing, { subjectStrengths: ['physics', 'maths'] });
    assert.deepEqual(result.profile.subjectStrengths, ['maths', 'physics']);
  });

  test('date fields accept Date and ISO strings, reject garbage', () => {
    const iso = '2026-07-30T10:00:00.000Z';
    const ok = mergeFlowV3Profile(baseProfile(), { lastSeenAt: iso });
    assert.ok(ok.profile.lastSeenAt instanceof Date);
    assert.equal(ok.profile.lastSeenAt.toISOString(), iso);

    const bad = mergeFlowV3Profile(baseProfile(), { lastSeenAt: 'not a date' });
    assert.equal(bad.profile.lastSeenAt, null);
    assert.ok(bad.dropped.some((d) => d.reason === MERGE_DROP_REASONS.INVALID_DATE));
    assert.equal(coerceDate('nope'), null);
  });

  test('structured entries merge by identity instead of duplicating', () => {
    const first = mergeFlowV3Profile(baseProfile(), {
      objections: [{ type: 'fee_too_high', raisedAtTurn: 3, verbatim: 'too costly', status: 'open' }],
    }).profile;

    const second = mergeFlowV3Profile(first, {
      objections: [{ type: 'fee_too_high', raisedAtTurn: 3, status: 'addressed', addressedHow: 'fee breakdown' }],
    }).profile;

    assert.equal(second.objections.length, 1);
    assert.equal(second.objections[0].status, 'addressed');
    assert.equal(second.objections[0].verbatim, 'too costly', 'verbatim must survive the update');
    assert.equal(second.objections[0].addressedHow, 'fee breakdown');
  });

  test('a different identity appends a new entry', () => {
    const profile = mergeFlowV3Profile(baseProfile(), {
      examResults: [{ exam: 'JEE_MAINS_2024', attemptYear: 2026, percentile: 91 }],
    }).profile;
    const next = mergeFlowV3Profile(profile, {
      examResults: [{ exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000 }],
    }).profile;
    assert.equal(next.examResults.length, 2, 'a second exam must not overwrite the first');
  });

  test('competitor identity is case-insensitive on name', () => {
    const merged = mergeStructuredArray(
      'competitorsMentioned',
      [{ name: 'Kalvium', context: 'comparing', turnId: 't1' }],
      [{ name: 'kalvium', context: 'comparing', turnId: 't4' }]
    );
    assert.equal(merged.array.length, 1);
    assert.equal(merged.array[0].turnId, 't4');
  });

  test('leadStageHistory is append-only even for identical entries', () => {
    const entry = { stage: 'engaged', reason: 'replied' };
    const first = mergeFlowV3Profile(baseProfile(), { leadStageHistory: [entry] }).profile;
    const second = mergeFlowV3Profile(first, { leadStageHistory: [entry] }).profile;
    assert.equal(second.leadStageHistory.length, 2);
  });

  test('non-object structured entries are refused', () => {
    const result = mergeFlowV3Profile(baseProfile(), { objections: ['fee_too_high'] });
    assert.deepEqual(result.profile.objections, []);
    assert.ok(result.warnings.some((w) => w.reason === MERGE_DROP_REASONS.INVALID_ENTRY));
  });

  test('exactly one exam entry stays primary', () => {
    const first = mergeFlowV3Profile(baseProfile(), {
      examResults: [{ exam: 'JEE_MAINS_2024', attemptYear: 2026, isPrimary: true }],
    }).profile;
    const second = mergeFlowV3Profile(first, {
      examResults: [{ exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000, isPrimary: true }],
    }).profile;

    const primaries = second.examResults.filter((entry) => entry.isPrimary === true);
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0].exam, 'AP_EAMCET', 'the newly flagged exam wins');
  });

  test('a lone exam entry is treated as primary', () => {
    const profile = mergeFlowV3Profile(baseProfile(), {
      examResults: [{ exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000 }],
    }).profile;
    assert.equal(profile.examResults[0].isPrimary, true);
  });
});

describe('Flow V3 merge — monotonic guards', () => {
  test('leadStage only moves forward', () => {
    const engaged = mergeFlowV3Profile(baseProfile(), { leadStage: 'engaged' }).profile;
    const back = mergeFlowV3Profile(engaged, { leadStage: 'new' });
    assert.equal(back.profile.leadStage, 'engaged');
    assert.ok(
      back.dropped.some((d) => d.reason === MERGE_DROP_REASONS.LEAD_STAGE_NOT_MONOTONIC)
    );

    const forward = mergeFlowV3Profile(engaged, { leadStage: 'qualified' });
    assert.equal(forward.profile.leadStage, 'qualified');
  });

  test('leadStage rejects unknown stages', () => {
    const result = mergeFlowV3Profile(baseProfile(), { leadStage: 'super_qualified' });
    assert.equal(result.profile.leadStage, null);
  });

  test('bookingStatus follows null → link_sent → done only (S-4)', () => {
    const linked = mergeFlowV3Profile(baseProfile(), { bookingStatus: 'link_sent' }).profile;
    assert.equal(linked.bookingStatus, 'link_sent');

    const done = mergeFlowV3Profile(linked, { bookingStatus: 'done' }).profile;
    assert.equal(done.bookingStatus, 'done');

    const regressed = mergeFlowV3Profile(done, { bookingStatus: 'link_sent' });
    assert.equal(regressed.profile.bookingStatus, 'done');
    assert.ok(
      regressed.dropped.some((d) => d.reason === MERGE_DROP_REASONS.BOOKING_STATUS_NOT_MONOTONIC)
    );
  });

  test('crisisLocked can never be unset (S-2)', () => {
    const locked = baseProfile({ crisisLocked: true });
    const result = mergeFlowV3Profile(locked, { crisisLocked: false });
    assert.equal(result.profile.crisisLocked, true);
    assert.ok(result.dropped.some((d) => d.reason === MERGE_DROP_REASONS.CRISIS_LOCK_PERMANENT));
  });

  test('crisisLocked can still be set to true', () => {
    const result = mergeFlowV3Profile(baseProfile(), { crisisLocked: true });
    assert.equal(result.profile.crisisLocked, true);
  });
});

describe('Flow V3 merge — purity', () => {
  test('inputs are never mutated', () => {
    const existing = baseProfile({ interests: ['ai'] });
    const snapshot = JSON.stringify(existing);
    const patch = { interests: ['robotics'], objections: [{ type: 'other', raisedAtTurn: 1 }] };
    const patchSnapshot = JSON.stringify(patch);

    mergeFlowV3Profile(existing, patch);

    assert.equal(JSON.stringify(existing), snapshot);
    assert.equal(JSON.stringify(patch), patchSnapshot);
  });
});
