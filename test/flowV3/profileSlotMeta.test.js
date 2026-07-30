'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SLOT_META_SOURCES,
  AUTHORITATIVE_SOURCES,
} = require('../../constants/flowV3/flowV3ProfileEnums');
const {
  encodeSlotMetaKey,
  decodeSlotMetaKey,
  deriveAcademicYear,
} = require('../../constants/flowV3/flowV3SlotMetaContract');
const meta = require('../../services/chatbot/flowV3LLM/profile/flowV3SlotMeta');

const TURN = 't-42';
const NOW = new Date('2026-07-30T10:00:00.000Z');

describe('slot meta contract — source enum', () => {
  test('source is the exact six-value contract enum', () => {
    assert.deepEqual(SLOT_META_SOURCES, [
      'button',
      'typed',
      'extracted',
      'inferred',
      'counsellor',
      'system',
    ]);
    assert.deepEqual(AUTHORITATIVE_SOURCES, ['button', 'typed', 'extracted', 'counsellor']);
  });

  test('an unknown source is rejected', () => {
    const result = meta.validateSlotMetaEntry('name', { source: 'llm', turnId: TURN });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === meta.SLOT_META_ERRORS.UNKNOWN_SOURCE));
  });

  test('an unknown field path is rejected', () => {
    const result = meta.validateSlotMetaEntry('notAField', { source: 'button', turnId: TURN });
    assert.ok(result.errors.some((e) => e.code === meta.SLOT_META_ERRORS.UNKNOWN_FIELD));
  });

  test('structured-array entry paths are known', () => {
    assert.equal(meta.isKnownFieldPath('examResults.0.rank'), true);
    assert.equal(meta.isKnownFieldPath('examResults.0.notAField'), false);
    assert.equal(meta.isKnownFieldPath('name'), true);
  });
});

describe('slot meta contract — mandatory fields', () => {
  test('confidence is mandatory when source=inferred', () => {
    const missing = meta.validateSlotMetaEntry('goalClarity', {
      source: 'inferred',
      verbatimQuote: 'not sure yet honestly',
      turnId: TURN,
    });
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.some((e) => e.code === meta.SLOT_META_ERRORS.CONFIDENCE_REQUIRED));

    const present = meta.validateSlotMetaEntry('goalClarity', {
      source: 'inferred',
      confidence: 0.7,
      verbatimQuote: 'not sure yet honestly',
      turnId: TURN,
    });
    assert.equal(present.valid, true);
  });

  test('confidence must be within 0-1', () => {
    const result = meta.validateSlotMetaEntry('goalClarity', {
      source: 'inferred',
      confidence: 1.4,
      verbatimQuote: 'q',
      turnId: TURN,
    });
    assert.ok(result.errors.some((e) => e.code === meta.SLOT_META_ERRORS.CONFIDENCE_OUT_OF_RANGE));
  });

  test('verbatimQuote is mandatory for typed, extracted and inferred', () => {
    for (const source of ['typed', 'extracted', 'inferred']) {
      const entry = { source, turnId: TURN };
      if (source === 'inferred') entry.confidence = 0.5;
      const result = meta.validateSlotMetaEntry('careerGoal', entry);
      assert.equal(result.valid, false, `${source} must require a verbatim quote`);
      assert.ok(result.errors.some((e) => e.code === meta.SLOT_META_ERRORS.VERBATIM_REQUIRED));
    }
  });

  test('button and system do not require a verbatim quote', () => {
    assert.equal(meta.validateSlotMetaEntry('goal', { source: 'button', turnId: TURN }).valid, true);
    assert.equal(meta.validateSlotMetaEntry('city', { source: 'system', turnId: TURN }).valid, true);
  });

  test('turnId is mandatory', () => {
    const result = meta.validateSlotMetaEntry('goal', { source: 'button' });
    assert.ok(result.errors.some((e) => e.code === meta.SLOT_META_ERRORS.TURN_ID_REQUIRED));
  });

  test('authoritative-only fields refuse an inferred source', () => {
    const result = meta.validateSlotMetaEntry('category', {
      source: 'inferred',
      confidence: 0.9,
      verbatimQuote: 'general category probably',
      turnId: TURN,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === meta.SLOT_META_ERRORS.INFERENCE_FORBIDDEN));
    assert.equal(meta.isInferenceForbiddenPath('examResults.0.gender'), true);
  });
});

describe('slot meta contract — entry shape', () => {
  test('academicYear is attached to volatile paths only', () => {
    const volatileEntry = meta.buildSlotMetaEntry(
      'rank',
      { source: 'extracted', verbatimQuote: 'rank 15000', turnId: TURN },
      { now: NOW }
    );
    assert.equal(volatileEntry.academicYear, deriveAcademicYear(NOW));

    const stableEntry = meta.buildSlotMetaEntry('name', { source: 'typed', verbatimQuote: 'Asha', turnId: TURN }, { now: NOW });
    assert.equal(stableEntry.academicYear, null);

    const nestedVolatile = meta.buildSlotMetaEntry(
      'examResults.0.rank',
      { source: 'extracted', verbatimQuote: 'rank 15000', turnId: TURN },
      { now: NOW }
    );
    assert.equal(nestedVolatile.academicYear, deriveAcademicYear(NOW));
  });

  test('a fresh entry carries every contract field', () => {
    const entry = meta.buildSlotMetaEntry('goal', { source: 'button', turnId: TURN }, { now: NOW });
    assert.deepEqual(Object.keys(entry).sort(), [
      'academicYear',
      'confidence',
      'history',
      'setAt',
      'source',
      'supersededBy',
      'turnId',
      'verbatimQuote',
    ]);
    assert.deepEqual(entry.history, []);
    assert.equal(entry.supersededBy, null);
    assert.equal(entry.setAt.getTime(), NOW.getTime());
  });
});

describe('slot meta store — history is append-only', () => {
  test('a correction archives the prior value with supersededBy', () => {
    const first = meta.applySlotMetaUpdates(
      {},
      { budgetBand: { source: 'button', turnId: 't1' } },
      { turnId: 't1', now: NOW, profileBefore: {}, profileAfter: { budgetBand: 'under_2l' } }
    );
    assert.deepEqual(first.applied, ['budgetBand']);

    const second = meta.applySlotMetaUpdates(
      first.slotMeta,
      { budgetBand: { source: 'typed', verbatimQuote: 'we can stretch to 4', turnId: 't5' } },
      {
        turnId: 't5',
        now: new Date(NOW.getTime() + 60000),
        profileBefore: { budgetBand: 'under_2l' },
        profileAfter: { budgetBand: '2_5l' },
      }
    );

    const entry = second.slotMeta.budgetBand;
    assert.equal(entry.source, 'typed');
    assert.equal(entry.history.length, 1);
    assert.equal(entry.history[0].value, 'under_2l');
    assert.equal(entry.history[0].source, 'button');
    assert.equal(entry.history[0].supersededBy, 't5');
  });

  test('history accumulates and is never truncated', () => {
    let store = {};
    let previous = null;
    for (let i = 1; i <= 4; i += 1) {
      const value = `value_${i}`;
      store = meta.applySlotMetaUpdates(
        store,
        { careerGoal: { source: 'typed', verbatimQuote: value, turnId: `t${i}` } },
        {
          turnId: `t${i}`,
          now: NOW,
          profileBefore: { careerGoal: previous },
          profileAfter: { careerGoal: value },
        }
      ).slotMeta;
      previous = value;
    }
    assert.equal(store.careerGoal.history.length, 3);
    assert.deepEqual(
      store.careerGoal.history.map((h) => h.value),
      ['value_1', 'value_2', 'value_3']
    );
    assert.deepEqual(
      store.careerGoal.history.map((h) => h.supersededBy),
      ['t2', 't3', 't4']
    );
  });

  test('an idempotent re-write does not grow history', () => {
    const args = {
      turnId: 't1',
      now: NOW,
      profileBefore: { goal: 'branch_fit' },
      profileAfter: { goal: 'branch_fit' },
    };
    const first = meta.applySlotMetaUpdates({}, { goal: { source: 'button', turnId: 't1' } }, args);
    const second = meta.applySlotMetaUpdates(
      first.slotMeta,
      { goal: { source: 'button', turnId: 't2' } },
      { ...args, turnId: 't2' }
    );
    assert.equal(second.slotMeta.goal.history.length, 0);
    assert.equal(second.slotMeta.goal.turnId, 't2');
  });

  test('an invalid entry is rejected and NOT applied', () => {
    const result = meta.applySlotMetaUpdates(
      {},
      { locality: { source: 'inferred', verbatimQuote: 'small town' } },
      { turnId: 't9', now: NOW }
    );
    assert.deepEqual(result.applied, []);
    assert.equal(result.slotMeta.locality, undefined);
    assert.ok(result.rejected.some((r) => r.code === meta.SLOT_META_ERRORS.CONFIDENCE_REQUIRED));
  });
});

describe('slot meta store — key encoding', () => {
  test('dots are escaped reversibly for safe document keys', () => {
    const path = 'examResults.0.rank';
    const encoded = encodeSlotMetaKey(path);
    assert.equal(encoded.includes('.'), false);
    assert.equal(decodeSlotMetaKey(encoded), path);
  });

  test('escape is reversible for the escape character itself', () => {
    for (const path of ['a~b', 'a.b~c', 'a$b', '~2e']) {
      assert.equal(decodeSlotMetaKey(encodeSlotMetaKey(path)), path);
    }
  });

  test('serialize/normalize round-trips a store', () => {
    const store = {
      'examResults.0.rank': { source: 'extracted', turnId: 't1' },
      name: { source: 'typed', turnId: 't1' },
    };
    const serialized = meta.serializeSlotMetaStore(store);
    assert.ok(Object.keys(serialized).includes('examResults~2e0~2erank'));
    assert.deepEqual(meta.normalizeSlotMetaStore(serialized), store);
  });

  test('normalize accepts a Map (Mongoose) as well as an object', () => {
    const map = new Map([['name', { source: 'typed', turnId: 't1' }]]);
    assert.deepEqual(meta.normalizeSlotMetaStore(map), { name: { source: 'typed', turnId: 't1' } });
    assert.deepEqual(meta.normalizeSlotMetaStore(null), {});
  });
});

describe('slot meta store — provenance queries', () => {
  test('inferred and authoritative paths are separable', () => {
    const store = {
      name: { source: 'typed', turnId: 't1' },
      locality: { source: 'inferred', confidence: 0.6, turnId: 't1' },
      goal: { source: 'button', turnId: 't2' },
    };
    assert.deepEqual(meta.listInferredPaths(store), ['locality']);
    assert.deepEqual(meta.listAuthoritativePaths(store), ['name', 'goal']);
  });
});
