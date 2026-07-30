'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { emptyFlowV3Profile } = require('../../constants/flowV3/flowV3LeadProfileSchema');
const {
  MIRROR_DIRECTION,
  MIRROR_WARNINGS,
  getPrimaryExamResult,
  mirrorExamResultsToLegacy,
  mirrorCompanionsToLegacy,
  mirrorObjectionsToLegacyConcerns,
  applyLegacyMirrors,
} = require('../../services/chatbot/flowV3LLM/profile/flowV3LegacyMirror');
const {
  mergeFlowV3Profile,
} = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileMerge');
const derived = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileDerived');

function baseProfile(overrides = {}) {
  return { ...emptyFlowV3Profile(), ...overrides };
}

describe('legacy mirror — examResults → flat slots', () => {
  test('mirrors every flat slot from the isPrimary entry', () => {
    const profile = baseProfile({
      examResults: [
        { exam: 'JEE_MAINS_2024', attemptYear: 2026, percentile: 91, isPrimary: false },
        {
          exam: 'AP_EAMCET',
          attemptYear: 2026,
          rank: 15000,
          percentile: 88,
          category: 'OC',
          gender: 'female',
          quota: 'HOME',
          region: 'AU',
          admissionType: 'GENERAL',
          isPrimary: true,
        },
      ],
    });

    const { patch } = mirrorExamResultsToLegacy(profile);
    assert.deepEqual(patch, {
      examType: 'AP_EAMCET',
      rank: 15000,
      percentile: 88,
      category: 'OC',
      gender: 'female',
      quota: 'HOME',
      region: 'AU',
      admissionType: 'GENERAL',
    });
  });

  test('a second exam does not overwrite the primary mirror', () => {
    const first = mergeFlowV3Profile(baseProfile(), {
      examResults: [{ exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000, isPrimary: true }],
    }).profile;
    const second = mergeFlowV3Profile(first, {
      examResults: [{ exam: 'JEE_MAINS_2024', attemptYear: 2026, percentile: 91 }],
    }).profile;

    assert.equal(second.examType, 'AP_EAMCET');
    assert.equal(second.rank, 15000);
    assert.equal(second.examResults.length, 2);
  });

  test('multiple exams with no primary flag mirror nothing and warn', () => {
    const profile = baseProfile({
      examResults: [
        { exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000 },
        { exam: 'KCET', attemptYear: 2026, rank: 8000 },
      ],
    });
    const result = mirrorExamResultsToLegacy(profile);
    assert.deepEqual(result.patch, {});
    assert.deepEqual(result.warnings, [MIRROR_WARNINGS.PRIMARY_EXAM_UNRESOLVED]);
    assert.equal(getPrimaryExamResult(profile), null);
  });

  test('NEVER reverse hydrates: editing a flat slot leaves examResults alone', () => {
    const profile = mergeFlowV3Profile(baseProfile(), {
      examResults: [{ exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000, isPrimary: true }],
    }).profile;

    const overwritten = mergeFlowV3Profile(profile, { rank: 99 }).profile;

    assert.equal(overwritten.examResults[0].rank, 15000, 'the array is not hydrated from the flat slot');
    assert.equal(overwritten.rank, 15000, 'the mirror re-asserts the primary entry value');
  });

  test('mirror direction is declared one-way', () => {
    assert.equal(MIRROR_DIRECTION, 'v3_to_legacy_only');
  });
});

describe('legacy mirror — companion arrays → legacy string', () => {
  test('joins the companion list into the legacy slot', () => {
    const profile = baseProfile({
      parentConstraintsList: ['nearby', 'known_brand'],
      collegeOfInterestList: ['Kalvium', 'Plaksha'],
    });
    const { patch } = mirrorCompanionsToLegacy(profile);
    assert.equal(patch.parentConstraints, 'nearby, known_brand');
    assert.equal(patch.collegeOfInterest, 'Kalvium, Plaksha');
  });

  test('does not clobber the legacy slot when the companion is empty', () => {
    const profile = baseProfile({ parentConstraints: 'nearby' });
    const { patch } = mirrorCompanionsToLegacy(profile);
    assert.equal('parentConstraints' in patch, false);
    assert.deepEqual(derived.getParentConstraintsList(profile), ['nearby']);
  });

  test('never splits the legacy string back into the companion', () => {
    const profile = mergeFlowV3Profile(baseProfile(), {
      parentConstraints: 'nearby, known_brand, student_call',
    }).profile;
    assert.deepEqual(profile.parentConstraintsList, []);
    assert.deepEqual(derived.getParentConstraintsList(profile), ['nearby, known_brand, student_call']);
  });
});

describe('legacy mirror — objections → concerns', () => {
  test('mirrors objection types into the legacy concerns array', () => {
    const profile = baseProfile({
      objections: [
        { type: 'fee_too_high', raisedAtTurn: 2 },
        { type: 'placement_doubt', raisedAtTurn: 4 },
      ],
      concerns: ['fee_too_high'],
    });
    const { patch } = mirrorObjectionsToLegacyConcerns(profile);
    assert.deepEqual(patch.concerns, ['fee_too_high', 'placement_doubt']);
  });

  test('keeps the student verbatim only on the structured objection', () => {
    const profile = mergeFlowV3Profile(baseProfile(), {
      objections: [{ type: 'roi_doubt', raisedAtTurn: 5, verbatim: 'is it worth 8 lakhs' }],
    }).profile;
    assert.deepEqual(profile.concerns, ['roi_doubt']);
    assert.equal(profile.objections[0].verbatim, 'is it worth 8 lakhs');
  });
});

describe('applyLegacyMirrors', () => {
  test('is pure by default and reports what it mirrored', () => {
    const profile = baseProfile({
      examResults: [{ exam: 'KCET', attemptYear: 2026, rank: 800, isPrimary: true }],
      collegeOfInterestList: ['Plaksha'],
    });
    const snapshot = JSON.stringify(profile);
    const result = applyLegacyMirrors(profile);

    assert.equal(JSON.stringify(profile), snapshot, 'source profile must not be mutated');
    assert.deepEqual(result.mirrored, {
      examType: 'KCET',
      rank: 800,
      collegeOfInterest: 'Plaksha',
    });
    assert.equal(result.profile.examType, 'KCET');
  });
});
