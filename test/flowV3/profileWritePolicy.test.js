'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileWritePolicy');
const { SLOT_META_ERRORS } = require('../../services/chatbot/flowV3LLM/profile/flowV3SlotMeta');

const TURN = 't-7';

function reject(patch, meta, channel = 'llm_tool') {
  return policy.validateProfilePatch({ patch, meta, channel, turnId: TURN });
}

describe('update_lead_profile allowlist — group H and I', () => {
  test('the LLM cannot write group H engagement fields (RULE B)', () => {
    const result = reject(
      { turnCount: 9, typedRatio: 0.8, medianResponseSec: 12, beatsSkipped: ['B4'] },
      {
        turnCount: { source: 'system' },
        typedRatio: { source: 'system' },
        medianResponseSec: { source: 'system' },
        beatsSkipped: { source: 'system' },
      }
    );
    assert.deepEqual(result.accepted, {});
    assert.equal(result.rejected.length, 4);
    for (const rejection of result.rejected) {
      assert.equal(rejection.code, policy.WRITE_POLICY_CODES.LLM_BLOCKED);
    }
  });

  test('the LLM cannot advance funnel state', () => {
    const result = reject(
      { leadStage: 'booked', bookingStatus: 'done', crisisLocked: false, exitReason: 'booked' },
      {
        leadStage: { source: 'system' },
        bookingStatus: { source: 'system' },
        crisisLocked: { source: 'system' },
        exitReason: { source: 'system' },
      }
    );
    assert.deepEqual(result.accepted, {});
    assert.equal(result.rejected.length, 4);
  });

  test('the LLM cannot write code-owned J/K records', () => {
    const result = reject(
      { shownArtifacts: [{ kind: 'curated_shortlist' }], counsellorNotes: 'keen', enrolledCollege: 'X' },
      {
        shownArtifacts: { source: 'system' },
        counsellorNotes: { source: 'counsellor' },
        enrolledCollege: { source: 'counsellor' },
      }
    );
    assert.deepEqual(result.accepted, {});
    assert.equal(result.rejected.length, 3);
  });
});

describe('update_lead_profile allowlist — Tier 3 / Tier 4 and consent', () => {
  test('Tier 3 fields are refused to the LLM tool', () => {
    const result = reject(
      { category: 'OC', gender: 'male', genderConstraint: true, firstGenerationCollege: true },
      {
        category: { source: 'extracted', verbatimQuote: 'OC' },
        gender: { source: 'extracted', verbatimQuote: 'male' },
        genderConstraint: { source: 'typed', verbatimQuote: 'no hostel far away' },
        firstGenerationCollege: { source: 'typed', verbatimQuote: 'first in family' },
      }
    );
    assert.deepEqual(result.accepted, {});
    assert.equal(result.rejected.length, 4);
  });

  test('Tier 3 fields REMAIN writable by system / button / extracted / counsellor', () => {
    for (const channel of ['system', 'button', 'extractor', 'counsellor']) {
      const result = policy.validateProfilePatch({
        patch: { category: 'OC', gender: 'male' },
        meta: {
          category: { source: 'button' },
          gender: { source: 'button' },
        },
        channel,
        turnId: TURN,
      });
      assert.deepEqual(result.accepted, { category: 'OC', gender: 'male' }, `${channel} must be able to write Tier 3`);
      assert.deepEqual(result.rejected, []);
    }
  });

  test('Tier 4 volunteered data is never written by the LLM tool', () => {
    const result = reject(
      { accessibilityNeeds: 'wheelchair access' },
      { accessibilityNeeds: { source: 'typed', verbatimQuote: 'I use a wheelchair' } }
    );
    assert.equal(result.rejected[0].code, policy.WRITE_POLICY_CODES.LLM_BLOCKED);
  });

  test('consent fields are blocked on EVERY channel pending the open items', () => {
    for (const channel of ['llm_tool', 'system', 'button', 'extractor', 'counsellor']) {
      const result = policy.validateProfilePatch({
        patch: { consentAt: new Date(), consentVersion: 'v1', isMinor: true },
        meta: {
          consentAt: { source: 'system' },
          consentVersion: { source: 'system' },
          isMinor: { source: 'system' },
        },
        channel,
        turnId: TURN,
      });
      assert.deepEqual(result.accepted, {}, `${channel} must not write consent fields`);
      assert.equal(result.rejected.length, 3);
      for (const rejection of result.rejected) {
        assert.equal(rejection.code, policy.WRITE_POLICY_CODES.SYSTEM_BLOCKED);
      }
    }
  });
});

describe('update_lead_profile — capture meta is mandatory per key', () => {
  test('a key with no meta is rejected', () => {
    const result = reject({ name: 'Asha' }, {});
    assert.equal(result.rejected[0].code, policy.WRITE_POLICY_CODES.META_MISSING);
    assert.deepEqual(result.accepted, {});
  });

  test("source='inferred' with no confidence is REJECTED, not silently accepted", () => {
    const result = reject(
      { goalClarity: 'exploring' },
      { goalClarity: { source: 'inferred', verbatimQuote: 'still deciding' } }
    );
    assert.deepEqual(result.accepted, {});
    assert.equal(result.rejected[0].code, SLOT_META_ERRORS.CONFIDENCE_REQUIRED);
  });

  test('inferred with confidence and a quote is accepted', () => {
    const result = reject(
      { goalClarity: 'exploring' },
      { goalClarity: { source: 'inferred', confidence: 0.6, verbatimQuote: 'still deciding' } }
    );
    assert.deepEqual(result.accepted, { goalClarity: 'exploring' });
    assert.equal(result.ok, true);
  });

  test('typed / extracted without a verbatim quote is rejected', () => {
    const result = reject({ careerGoal: 'data science' }, { careerGoal: { source: 'typed' } });
    assert.equal(result.rejected[0].code, SLOT_META_ERRORS.VERBATIM_REQUIRED);
  });
});

describe('update_lead_profile — value space', () => {
  test('unknown keys are dropped, not rejected (schema is the contract)', () => {
    const result = reject({ favouriteColour: 'blue' }, { favouriteColour: { source: 'typed', verbatimQuote: 'blue' } });
    assert.deepEqual(result.dropped.map((d) => d.field), ['favouriteColour']);
    assert.deepEqual(result.rejected, []);
  });

  test('a §3 DO NOT BUILD field name is refused loudly', () => {
    const result = reject(
      { desperationScore: 0.9, personalityType: 'anxious' },
      {
        desperationScore: { source: 'inferred', confidence: 0.9, verbatimQuote: 'x' },
        personalityType: { source: 'inferred', confidence: 0.9, verbatimQuote: 'x' },
      }
    );
    assert.deepEqual(result.dropped, []);
    assert.equal(result.rejected.length, 2);
    for (const rejection of result.rejected) {
      assert.equal(rejection.code, policy.WRITE_POLICY_CODES.EXCLUDED_CATEGORY);
    }
  });

  test('out-of-enum values on new fields are rejected', () => {
    const result = reject(
      { budgetBasis: 'per_month' },
      { budgetBasis: { source: 'typed', verbatimQuote: 'per month' } }
    );
    assert.equal(result.rejected[0].code, policy.WRITE_POLICY_CODES.INVALID_ENUM);
  });

  test('an unknown write channel is refused', () => {
    const result = policy.validateProfilePatch({
      patch: { name: 'Asha' },
      meta: { name: { source: 'typed', verbatimQuote: 'Asha' } },
      channel: 'god_mode',
      turnId: TURN,
    });
    assert.equal(result.rejected[0].code, policy.WRITE_POLICY_CODES.UNKNOWN_CHANNEL);
  });
});

describe('update_lead_profile — structured arrays', () => {
  test('examResults is writable but its Tier 3 entry fields are stripped and reported', () => {
    const result = reject(
      {
        examResults: [
          {
            exam: 'AP_EAMCET',
            attemptYear: 2026,
            rank: 15000,
            status: 'scored',
            category: 'OC',
            gender: 'male',
            isPrimary: true,
          },
        ],
      },
      { examResults: { source: 'extracted', verbatimQuote: 'AP EAMCET 15000' } }
    );

    assert.deepEqual(result.accepted.examResults, [
      { exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000, status: 'scored', isPrimary: true },
    ]);
    assert.deepEqual(
      result.rejected.map((r) => [r.field, r.code]),
      [
        ['examResults.category', policy.WRITE_POLICY_CODES.NESTED_BLOCKED],
        ['examResults.gender', policy.WRITE_POLICY_CODES.NESTED_BLOCKED],
      ]
    );
  });

  test('the extractor channel may write exam category and gender', () => {
    const result = policy.validateProfilePatch({
      patch: { examResults: [{ exam: 'AP_EAMCET', attemptYear: 2026, category: 'OC', gender: 'male' }] },
      meta: { examResults: { source: 'extracted', verbatimQuote: 'OC male AP EAMCET' } },
      channel: 'extractor',
      turnId: TURN,
    });
    assert.deepEqual(result.rejected, []);
    assert.equal(result.accepted.examResults[0].category, 'OC');
  });

  test('unknown entry fields are dropped and bad entry enums rejected', () => {
    const result = reject(
      { objections: [{ type: 'not_a_type', raisedAtTurn: 2, mood: 'sad' }] },
      { objections: { source: 'typed', verbatimQuote: 'too costly' } }
    );
    assert.ok(result.rejected.some((r) => r.code === policy.WRITE_POLICY_CODES.INVALID_ENUM));
    assert.equal(result.accepted.objections, undefined);
  });

  test('a non-object entry is refused', () => {
    const result = reject(
      { competitorsMentioned: ['Kalvium'] },
      { competitorsMentioned: { source: 'typed', verbatimQuote: 'Kalvium' } }
    );
    assert.ok(result.rejected.some((r) => r.code === policy.WRITE_POLICY_CODES.INVALID_ENTRY));
  });
});

describe('isWritableByChannel', () => {
  test('reports the reason per field and channel', () => {
    assert.equal(policy.isWritableByChannel('name', 'llm_tool').allowed, true);
    assert.equal(policy.isWritableByChannel('turnCount', 'llm_tool').code, policy.WRITE_POLICY_CODES.LLM_BLOCKED);
    assert.equal(policy.isWritableByChannel('turnCount', 'system').allowed, true);
    assert.equal(policy.isWritableByChannel('nope', 'system').code, policy.WRITE_POLICY_CODES.UNKNOWN_FIELD);
    assert.equal(policy.isExcludedFieldName('easilyPressured'), true);
  });
});
