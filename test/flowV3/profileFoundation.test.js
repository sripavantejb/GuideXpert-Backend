'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const FlowV3LeadProfile = require('../../models/FlowV3LeadProfile');
const FlowV3TurnLog = require('../../models/FlowV3TurnLog');
const { hashPhone } = require('../../services/chatbot/flowV3LLM/profile/flowV3PhoneHash');
const {
  resolveTurnLogPhoneHash,
  checkFlowV3LogHealth,
  _resetPepperErrorLatch,
} = require('../../services/chatbot/flowV3LLM/log/flowV3TurnLogPhone');
const {
  resolveIsMinor,
  assertNotDerivedFromPassingYear,
} = require('../../services/chatbot/flowV3LLM/profile/flowV3MinorPolicy');
const { resolveBookingServiceKey } = require('../../constants/flowV3/flowV3BookingConfig');
const { SLOT_META_SOURCES } = require('../../constants/flowV3/flowV3ProfileEnums');
const { validateSlotMeta } = require('../../constants/flowV3/flowV3SlotMetaContract');
const {
  getTierPolicy,
  SENSITIVITY_TIERS,
  TTL_INDEXES_FORBIDDEN,
  monthsToMs,
} = require('../../constants/flowV3/flowV3Retention');
const {
  getFieldTier,
  EXCLUDED_FIELD_NAME_PATTERNS,
  COMPANION_FIELDS,
  COMPANION_FIELDS: LEAD_COMPANIONS,
  emptyFlowV3Profile,
  listLiveSlotNames,
  VOLATILE_STALE_MS,
  canLlmWriteField,
} = require('../../constants/flowV3/flowV3LeadProfileSchema');
const { mergeFlowV3Profile } = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileMerge');
const { applySlotMetaUpdates } = require('../../services/chatbot/flowV3LLM/profile/flowV3SlotMeta');
const { mirrorPrimaryExamToLegacy } = require('../../services/chatbot/flowV3LLM/profile/flowV3LegacyMirror');
const { deriveReadViews } = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileDerived');
const { isStale, isEmptyForV3Gating } = require('../../services/chatbot/flowV3LLM/profile/flowV3Staleness');
const { nextFlowV3Slot } = require('../../services/chatbot/flowV3LLM/profile/flowV3NextSlot');
const { profileCollectionHasTtlIndex } = require('../../services/chatbot/flowV3LLM/profile');
const { emptyFlowV2Profile } = require('../../constants/careerCounsellingFlowV2Profile');

describe('FlowV3LeadProfile schema', () => {
  test('unique 10-digit phone and no TTL index', () => {
    const phonePath = FlowV3LeadProfile.schema.path('phone');
    assert.equal(phonePath.options.unique, true);
    assert.ok(phonePath.options.match);
    assert.equal(profileCollectionHasTtlIndex(FlowV3LeadProfile), false);
    const indexes = FlowV3LeadProfile.schema.indexes();
    assert.equal(
      indexes.some(([, opts]) => opts && opts.expireAfterSeconds != null),
      false
    );
  });

  test('empty profile retains all 75 live slot names', () => {
    const live = listLiveSlotNames();
    assert.equal(live.length, 75);
    const profile = emptyFlowV3Profile();
    for (const key of live) {
      assert.ok(key in profile, `missing live slot ${key}`);
    }
    assert.ok('parentConstraintsList' in COMPANION_FIELDS || 'parentConstraintsList' in LEAD_COMPANIONS);
    assert.ok('collegeOfInterestList' in COMPANION_FIELDS || 'collegeOfInterestList' in LEAD_COMPANIONS);
    assert.ok('parentConstraintsList' in profile);
    assert.ok('collegeOfInterestList' in profile);
  });
});

describe('FlowV3TurnLog', () => {
  test('schema has §9.3 accounting fields and no TTL', () => {
    for (const field of [
      'phoneHash',
      'sentParts',
      'toolCalls',
      'llmCalls',
      'validationVerdicts',
      'latencyBreakdown',
    ]) {
      assert.ok(FlowV3TurnLog.schema.path(field), `missing ${field}`);
    }
    assert.equal(
      FlowV3TurnLog.schema.indexes().some(([, opts]) => opts && opts.expireAfterSeconds != null),
      false
    );
  });

  test('phoneHash is optional so a missing pepper cannot lose the whole turn log', () => {
    assert.notEqual(FlowV3TurnLog.schema.path('phoneHash').isRequired, true);
  });

  test('hashPhone uses pepper material', () => {
    const a = hashPhone('9876543210', { pepper: 'pepper-a' });
    const b = hashPhone('9876543210', { pepper: 'pepper-b' });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notEqual(a.hash, b.hash);
    assert.equal(a.hash.length, 64);
  });

  test('missing pepper omits the phone field, errors once, and never returns a raw phone', () => {
    _resetPepperErrorLatch();
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const phone = '9876543210';
      const out1 = resolveTurnLogPhoneHash(phone, { pepper: '' });
      const out2 = resolveTurnLogPhoneHash(phone, { pepper: '' });
      assert.equal(out1.phoneHash, null);
      assert.equal(out1.omitted, true);
      assert.equal(out2.phoneHash, null);
      // ERROR logged once per process (latch), not once per call
      assert.equal(errors.length, 1);
      const joined = errors.join(' ');
      assert.equal(joined.includes(phone), false, 'raw number must never appear in any log line');
      assert.match(joined, /phone_hash_pepper_missing/);
    } finally {
      console.error = originalError;
    }
  });

  test('startup health check reports unhealthy with fatal:false and does not exit', () => {
    const originalError = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    try {
      const bad = checkFlowV3LogHealth({});
      assert.equal(bad.healthy, false);
      assert.equal(bad.checks[0].ok, false);
      assert.match(lines.join(' '), /"fatal":false/);
      // Process must still be alive — if checkFlowV3LogHealth called process.exit
      // this assertion would never run.
      assert.equal(process.exitCode, undefined);
      const good = checkFlowV3LogHealth({ FLOW_V3_PHONE_HASH_PEPPER: 'set' });
      assert.equal(good.healthy, true);
    } finally {
      console.error = originalError;
    }
  });
});

describe('isMinor policy', () => {
  test('defaults to true for the school-leaving cohort', () => {
    const out = resolveIsMinor({});
    assert.equal(out.isMinor, true);
    assert.equal(out.authoritative, false);
  });

  test('only a stated age can produce false', () => {
    assert.equal(resolveIsMinor({ statedAge: 19, source: 'typed' }).isMinor, false);
    assert.equal(resolveIsMinor({ statedAge: 19, source: 'inferred' }).isMinor, true);
    assert.equal(resolveIsMinor({ statedAge: 16, source: 'typed' }).isMinor, true);
  });

  test('never derived from passingYear', () => {
    assert.throws(() => assertNotDerivedFromPassingYear(['passingYear']));
    assert.equal(resolveIsMinor({ passingYear: 2020 }).isMinor, true);
  });
});

describe('D-6 booking service resolution', () => {
  test('unset config yields no serviceKey rather than a guess', () => {
    const out = resolveBookingServiceKey({}, { env: {} });
    assert.equal(out.serviceKey, null);
    assert.equal(out.source, 'unresolved');
  });

  test('config default is used when set', () => {
    const out = resolveBookingServiceKey(
      {},
      { env: { FLOW_V3_DEFAULT_BOOKING_SERVICE: 'one_on_one' } }
    );
    assert.equal(out.serviceKey, 'one_on_one');
    assert.equal(out.source, 'config_default');
  });
});

describe('slot meta + retention + allowlist', () => {
  test('source enum matches contract', () => {
    assert.deepEqual([...SLOT_META_SOURCES], [
      'button',
      'typed',
      'extracted',
      'inferred',
      'counsellor',
      'system',
    ]);
  });

  test('rejects inferred without confidence and typed without quote', () => {
    assert.equal(validateSlotMeta({ source: 'inferred' }).ok, false);
    assert.equal(validateSlotMeta({ source: 'typed', confidence: 1 }).ok, false);
    assert.equal(
      validateSlotMeta({ source: 'inferred', confidence: 0.8, verbatimQuote: 'maybe CSE' }).ok,
      true
    );
  });

  test('retention tiers executable as metadata helpers', () => {
    assert.equal(TTL_INDEXES_FORBIDDEN, true);
    assert.equal(getFieldTier('category'), 3);
    assert.equal(getFieldTier('accessibilityNeeds'), 4);
    assert.equal(getTierPolicy(2).tier, 2);
    assert.equal(SENSITIVITY_TIERS[2].retention.months, 24);
    assert.ok(EXCLUDED_FIELD_NAME_PATTERNS.some((re) => re.test('desperation_score')));
    assert.ok(monthsToMs(24) > monthsToMs(6));
  });

  test('LLM allowlist denies H/I consent crisis tier3/4', () => {
    assert.equal(canLlmWriteField('leadStage').allowed, false);
    assert.equal(canLlmWriteField('consentAt').allowed, false);
    assert.equal(canLlmWriteField('crisisLocked').allowed, false);
    assert.equal(canLlmWriteField('category').allowed, false);
    assert.equal(canLlmWriteField('goal').allowed, true);
    assert.equal(canLlmWriteField('parentConstraintsList').allowed, true);
  });
});

describe('merge + exam mirror + staleness + nextSlot', () => {
  test('delegates legacy keys and accepts companions', () => {
    const base = emptyFlowV2Profile();
    const { profile, applied, dropped } = mergeFlowV3Profile(base, {
      goal: 'engineering',
      parentConstraintsList: ['fees'],
      unknownX: 1,
    });
    assert.equal(profile.goal, 'engineering');
    assert.deepEqual(profile.parentConstraintsList, ['fees']);
    assert.ok(applied.includes('goal'));
    assert.ok(dropped.some((d) => d.field === 'unknownX'));
  });

  test('primary exam mirrors one-way to legacy; never hydrates array from legacy', () => {
    const mirrored = mirrorPrimaryExamToLegacy({
      examResults: [
        {
          isPrimary: true,
          exam: 'ts_eamcet',
          rank: 5000,
          category: 'OC',
          gender: 'female',
        },
      ],
    });
    assert.equal(mirrored.examType, 'ts_eamcet');
    assert.equal(mirrored.rank, 5000);
    assert.equal(mirrored.category, 'OC');
    const noHydrate = mirrorPrimaryExamToLegacy({
      examType: 'ap_eamcet',
      rank: 1,
      examResults: [],
    });
    assert.deepEqual(noHydrate.examResults, []);
    assert.equal(noHydrate.examType, 'ap_eamcet');
  });

  test('unresolved primary (multiple entries, none flagged) refuses to guess', () => {
    const out = mirrorPrimaryExamToLegacy({
      examResults: [
        { exam: 'AP_EAMCET', rank: 100 },
        { exam: 'TS_EAMCET', rank: 200 },
      ],
    });
    assert.equal(out.examType, undefined);
    assert.equal(out.rank, undefined);
  });

  test('derive read views for coreInterest bool and goalPriority enum', () => {
    const views = deriveReadViews({
      coreInterest: 'building',
      goalPriority: ['placement', 'fees'],
      parentConstraints: 'no hostel',
    });
    assert.equal(views.coreInterestBool, true);
    assert.equal(views.goalPriorityEnum, 'placement');
    assert.deepEqual(views.parentConstraintsList, ['no hostel']);
  });

  test('stale volatile treated as empty; inferred masked in nextSlot', () => {
    const old = new Date(Date.now() - VOLATILE_STALE_MS - 1000);
    // schema stale:'V' is authoritative — timeline (not the deleted facade's urgency)
    assert.equal(
      isStale({ setAt: old, source: 'typed' }, { path: 'timeline', now: new Date() }),
      true
    );
    assert.equal(
      isEmptyForV3Gating('hot', { source: 'inferred', confidence: 0.9, verbatimQuote: 'x' }),
      true
    );

    const profile = emptyFlowV2Profile();
    profile.qualification = '12th';
    const slotMeta = {
      qualification: {
        source: 'inferred',
        confidence: 0.7,
        verbatimQuote: 'maybe 12th',
        setAt: new Date(),
      },
    };
    const next = nextFlowV3Slot(profile, { slotMeta });
    assert.equal(next.done, undefined);
    assert.equal(next.slot, 'qualification');
    assert.equal(next.reason, 'inferred_non_authoritative');
    assert.equal(typeof next.beat, 'string');
    assert.equal(next.askable, true);
  });

  test('history append on supersede via slot meta updates', () => {
    const before = { ...emptyFlowV2Profile(), city: 'Hyderabad' };
    const { profile: after } = mergeFlowV3Profile(before, { city: 'Warangal' });

    const outcome = applySlotMetaUpdates(
      { city: { source: 'typed', verbatimQuote: 'Hyd', setAt: new Date(), turnId: 't1', history: [] } },
      { city: { source: 'typed', verbatimQuote: 'Warangal' } },
      { turnId: 't2', profileBefore: before, profileAfter: after }
    );

    assert.ok(Array.isArray(outcome.slotMeta.city.history));
    assert.ok(outcome.slotMeta.city.history.length >= 1);
  });
});
