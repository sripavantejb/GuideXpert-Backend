'use strict';

require('../../config/mongooseSafety');

const { after, before, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PHONE = '9876543210';

let memoryServer;
let FlowV3LeadProfile;
let store;

const { encodeSlotMetaKey } = require('../../constants/flowV3/flowV3SlotMetaContract');
const { normalizeSlotMetaStore, serializeSlotMetaStore } = require('../../services/chatbot/flowV3LLM/profile/flowV3SlotMeta');

describe('FlowV3LeadProfile store', () => {
  before(async () => {
    FlowV3LeadProfile = require('../../models/FlowV3LeadProfile');
    store = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileStore');
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(), {
      dbName: 'flow_v3_profile_store',
      serverSelectionTimeoutMS: 10000,
    });
    await FlowV3LeadProfile.syncIndexes();
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  });

  beforeEach(async () => {
    await FlowV3LeadProfile.deleteMany({});
  });

  test('the collection has NO TTL index and no stateExpiresAt path (G-2)', async () => {
    const indexes = await FlowV3LeadProfile.collection.indexes();
    for (const index of indexes) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(index, 'expireAfterSeconds'),
        false,
        `${index.name} is a TTL index — the durable profile must never be swept`
      );
    }
    assert.equal(FlowV3LeadProfile.schema.path('stateExpiresAt'), undefined);
    FlowV3LeadProfile.schema.eachPath((path, type) => {
      assert.equal(type.options.expires, undefined, `${path} declares an expiry`);
    });
  });

  test('phone is unique', async () => {
    await store.ensureProfileDoc(PHONE);
    await assert.rejects(
      () => FlowV3LeadProfile.create({ phone: PHONE }),
      (err) => err.code === 11000
    );
  });

  test('a fresh document starts with the full empty profile and version 0', async () => {
    const doc = await store.ensureProfileDoc(PHONE);
    assert.equal(doc.__v, 0);
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.profile.phone, PHONE);
    assert.deepEqual(doc.profile.interests, []);
    assert.equal(doc.profile.rank, null);
    assert.ok(doc.academicYear > 2020);
  });

  test('applyProfilePatch writes, mirrors and bumps __v', async () => {
    const result = await store.applyProfilePatch({
      phone: PHONE,
      channel: 'extractor',
      turnId: 't1',
      patch: {
        name: 'Asha',
        examResults: [
          { exam: 'AP_EAMCET', attemptYear: 2026, rank: 15000, category: 'OC', gender: 'female', isPrimary: true },
        ],
      },
      meta: {
        name: { source: 'typed', verbatimQuote: 'Asha here' },
        examResults: { source: 'extracted', verbatimQuote: 'ap eamcet 15000 oc female' },
      },
    });

    assert.equal(result.written, true);
    assert.equal(result.version, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.profile.examType, 'AP_EAMCET');
    assert.equal(result.profile.category, 'OC');

    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.profile.name, 'Asha');
    assert.equal(loaded.profile.rank, 15000);
    assert.equal(loaded.slotMeta.name.source, 'typed');
    assert.equal(loaded.slotMeta.rank.source, 'system', 'a mirrored slot is code-written, not a capture');
  });

  test('a second write merges rather than replacing, and keeps the version monotonic', async () => {
    await store.applyProfilePatch({
      phone: PHONE,
      channel: 'button',
      turnId: 't1',
      patch: { interests: ['ai'] },
      meta: { interests: { source: 'button' } },
    });
    const second = await store.applyProfilePatch({
      phone: PHONE,
      channel: 'button',
      turnId: 't2',
      patch: { interests: ['robotics'], goal: 'branch_fit' },
      meta: { interests: { source: 'button' }, goal: { source: 'button' } },
    });

    assert.equal(second.version, 2);
    const loaded = await store.loadProfile(PHONE);
    assert.deepEqual(loaded.profile.interests, ['ai', 'robotics']);
    assert.equal(loaded.profile.goal, 'branch_fit');
  });

  test('blocked keys are rejected without blocking the writable ones', async () => {
    const result = await store.applyProfilePatch({
      phone: PHONE,
      channel: 'llm_tool',
      turnId: 't3',
      patch: { goal: 'career_scope', leadStage: 'booked', turnCount: 12 },
      meta: {
        goal: { source: 'button' },
        leadStage: { source: 'system' },
        turnCount: { source: 'system' },
      },
    });

    assert.equal(result.written, true);
    assert.equal(result.ok, false);
    assert.deepEqual(result.rejected.map((r) => r.field).sort(), ['leadStage', 'turnCount']);

    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.profile.goal, 'career_scope');
    assert.equal(loaded.profile.leadStage, null);
    assert.equal(loaded.profile.turnCount, null);
  });

  test('requireAllAccepted refuses the whole write', async () => {
    const result = await store.applyProfilePatch({
      phone: PHONE,
      channel: 'llm_tool',
      turnId: 't4',
      requireAllAccepted: true,
      patch: { goal: 'career_scope', crisisLocked: false },
      meta: { goal: { source: 'button' }, crisisLocked: { source: 'system' } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.written, false);
    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded, null, 'nothing is created when the patch is refused wholesale');
  });

  test('CAS retries a lost race and still lands the write', async () => {
    await store.ensureProfileDoc(PHONE);
    const originalUpdateOne = FlowV3LeadProfile.updateOne.bind(FlowV3LeadProfile);
    let calls = 0;
    FlowV3LeadProfile.updateOne = async (...args) => {
      calls += 1;
      if (calls === 1) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      return originalUpdateOne(...args);
    };

    try {
      const result = await store.applyProfilePatch({
        phone: PHONE,
        channel: 'button',
        turnId: 't5',
        patch: { goal: 'college_fit' },
        meta: { goal: { source: 'button' } },
      });
      assert.equal(result.attempts, 2);
      assert.equal(result.written, true);
    } finally {
      FlowV3LeadProfile.updateOne = originalUpdateOne;
    }

    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.profile.goal, 'college_fit');
  });

  test('CAS retries are BOUNDED and then fail loudly', async () => {
    await store.ensureProfileDoc(PHONE);
    const originalUpdateOne = FlowV3LeadProfile.updateOne.bind(FlowV3LeadProfile);
    let calls = 0;
    FlowV3LeadProfile.updateOne = async () => {
      calls += 1;
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    };

    try {
      await assert.rejects(
        () =>
          store.applyProfilePatch({
            phone: PHONE,
            channel: 'button',
            turnId: 't6',
            patch: { goal: 'college_fit' },
            meta: { goal: { source: 'button' } },
          }),
        (err) => {
          assert.equal(err.name, 'FlowV3CasConflictError');
          assert.equal(err.code, 'FLOW_V3_PROFILE_CAS_CONFLICT');
          assert.equal(err.attempts, store.DEFAULT_MAX_CAS_ATTEMPTS);
          return true;
        }
      );
      assert.equal(calls, store.DEFAULT_MAX_CAS_ATTEMPTS);
    } finally {
      FlowV3LeadProfile.updateOne = originalUpdateOne;
    }
  });

  test('concurrent writes to the same phone both survive', async () => {
    await Promise.all([
      store.applyProfilePatch({
        phone: PHONE,
        channel: 'button',
        turnId: 'c1',
        patch: { goal: 'branch_fit' },
        meta: { goal: { source: 'button' } },
      }),
      store.applyProfilePatch({
        phone: PHONE,
        channel: 'button',
        turnId: 'c2',
        patch: { qualification: 'Class 12' },
        meta: { qualification: { source: 'button' } },
      }),
    ]);

    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.profile.goal, 'branch_fit');
    assert.equal(loaded.profile.qualification, 'Class 12');
    assert.equal(loaded.version, 2);
  });

  test('slotMeta keys with dots are stored escaped and read back decoded', async () => {
    const path = 'examResults.0.rank';
    const entry = { source: 'extracted', verbatimQuote: 'rank 15000', turnId: 't7', setAt: new Date(), academicYear: 2027 };

    await store.withCas(PHONE, (doc) => ({
      set: { slotMeta: serializeSlotMetaStore({ ...normalizeSlotMetaStore(doc.slotMeta), [path]: entry }) },
      result: {},
    }));

    const raw = await FlowV3LeadProfile.collection.findOne({ phone: PHONE });
    assert.ok(Object.keys(raw.slotMeta).includes(encodeSlotMetaKey(path)));
    for (const key of Object.keys(raw.slotMeta)) {
      assert.equal(key.includes('.'), false, 'stored Map keys must not contain dots');
    }

    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.slotMeta[path].verbatimQuote, 'rank 15000');
  });

  test('appendConversation is idempotent per conversationId', async () => {
    const conversationId = new mongoose.Types.ObjectId();
    const first = await store.appendConversation({
      phone: PHONE,
      conversationId,
      engine: 'career_counselling_flow_v3',
      promptVersion: 'v1',
    });
    const second = await store.appendConversation({ phone: PHONE, conversationId, engine: 'career_counselling_flow_v3' });

    assert.equal(first.added, true);
    assert.equal(second.added, false);
    assert.equal(second.written, false);

    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.conversations.length, 1);
    assert.equal(loaded.conversations[0].promptVersion, 'v1');
  });

  test('updateRollingSummary stores the summary and its turn count', async () => {
    await store.updateRollingSummary({ phone: PHONE, summary: 'wants CS, budget tight', summaryTurnCount: 6 });
    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.summary, 'wants CS, budget tight');
    assert.equal(loaded.summaryTurnCount, 6);
  });

  test('the profile survives independently of any conversation TTL', async () => {
    await store.applyProfilePatch({
      phone: PHONE,
      channel: 'button',
      turnId: 't8',
      patch: { qualification: 'Class 12', goal: 'branch_fit', interests: ['ai', 'design'] },
      meta: {
        qualification: { source: 'button' },
        goal: { source: 'button' },
        interests: { source: 'button' },
      },
    });

    // Simulate a session expiring: bot state is gone, the profile is not.
    const loaded = await store.loadProfile(PHONE);
    assert.equal(loaded.profile.qualification, 'Class 12');
    assert.deepEqual(loaded.profile.interests, ['ai', 'design']);
  });
});

/**
 * The tool/context layers call the profile package by its older names. These
 * must resolve to the SAME `__v` CAS path — a compat layer that versions on a
 * field the model does not declare reads `undefined` and rejects every write.
 */
describe('FlowV3 profile package compat surface', () => {
  let compatServer;
  let api;

  before(async () => {
    FlowV3LeadProfile = require('../../models/FlowV3LeadProfile');
    api = require('../../services/chatbot/flowV3LLM/profile');
    compatServer = await MongoMemoryServer.create();
    await mongoose.connect(compatServer.getUri(), {
      dbName: 'flow_v3_profile_compat',
      serverSelectionTimeoutMS: 10000,
    });
    await FlowV3LeadProfile.syncIndexes();
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (compatServer) {
      await compatServer.stop();
      compatServer = null;
    }
  });

  beforeEach(async () => {
    await FlowV3LeadProfile.deleteMany({});
  });

  test('casVersion is exposed as an alias of __v, not a second version field', async () => {
    const created = await api.ensureLeadProfile(PHONE);
    assert.equal(created.casVersion, 0);
    assert.equal(created.casVersion, created.__v);
    assert.equal(FlowV3LeadProfile.schema.path('casVersion'), undefined);
  });

  test('casUpdateLeadProfile actually lands an LLM write and advances the version', async () => {
    const created = await api.ensureLeadProfile(PHONE);
    const outcome = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { goal: 'branch_fit' },
      metaByPath: { goal: { source: 'typed', verbatimQuote: 'which branch suits me' } },
      enforceLlmAllowlist: true,
      turnId: 'compat-1',
    });

    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.applied, ['goal']);
    assert.equal(outcome.doc.profile.goal, 'branch_fit');
    assert.equal(outcome.doc.casVersion, created.casVersion + 1);
  });

  test('a stale expectedVersion is a conflict, not a silent overwrite', async () => {
    const created = await api.ensureLeadProfile(PHONE);
    await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { goal: 'branch_fit' },
      metaByPath: { goal: { source: 'button' } },
      turnId: 'compat-stale-1',
    });

    const stale = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { goal: 'career_scope' },
      metaByPath: { goal: { source: 'button' } },
      turnId: 'compat-stale-2',
    });

    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'cas_conflict');
    assert.equal(stale.doc.casVersion, 1);
    assert.equal(stale.doc.profile.goal, 'branch_fit', 'the winning turn keeps its value');
  });

  test('a patch where every key is rejected is reported as denied, not saved', async () => {
    const created = await api.ensureLeadProfile(PHONE);
    const outcome = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { goal: 'branch_fit' },
      // no turnId — the slot meta contract requires one on every entry
      metaByPath: { goal: { source: 'button' } },
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'write_denied');
    assert.deepEqual(outcome.applied, []);
    assert.equal(outcome.rejected[0].field, 'goal');
    assert.equal(outcome.doc.profile.goal, null);
  });

  test('a patch whose every key is unknown is write_denied, not a silent success', async () => {
    const created = await api.ensureLeadProfile(PHONE);
    const outcome = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { totallyFakeField: 'x', alsoNotReal: 1 },
      metaByPath: {
        totallyFakeField: { source: 'typed', verbatimQuote: 'x' },
        alsoNotReal: { source: 'typed', verbatimQuote: '1' },
      },
      turnId: 'compat-dropped',
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'write_denied');
    assert.deepEqual(outcome.applied, []);
    assert.ok(outcome.dropped.length >= 2);
  });

  test('an unknown phone is reported, never created by a write', async () => {
    const outcome = await api.casUpdateLeadProfile({
      phone: '9000000000',
      expectedVersion: 0,
      profilePatch: { goal: 'branch_fit' },
      metaByPath: { goal: { source: 'button' } },
      turnId: 'compat-missing',
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'not_found');
    assert.equal(await FlowV3LeadProfile.countDocuments({ phone: '9000000000' }), 0);
  });

  test('the allowlist still applies through the compat layer', async () => {
    const created = await api.ensureLeadProfile(PHONE);

    const blocked = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { category: 'sc', consentAt: new Date(), goal: 'branch_fit' },
      metaByPath: {
        category: { source: 'typed', verbatimQuote: 'sc' },
        consentAt: { source: 'system' },
        goal: { source: 'button' },
      },
      enforceLlmAllowlist: true,
      turnId: 'compat-2',
    });
    assert.deepEqual(blocked.rejected.map((r) => r.field).sort(), ['category', 'consentAt']);
    assert.equal(blocked.doc.profile.category, null);
    assert.equal(blocked.doc.profile.goal, 'branch_fit');

    // Same Tier 3 field, non-LLM channel: allowed.
    const allowed = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: blocked.doc.casVersion,
      profilePatch: { category: 'sc' },
      metaByPath: { category: { source: 'button' } },
      enforceLlmAllowlist: false,
      turnId: 'compat-3',
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.doc.profile.category, 'sc');
  });

  test('a pin the profile schema does not declare is warned about, not dropped in silence', async () => {
    const created = await api.ensureLeadProfile(PHONE);
    const outcome = await api.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: created.casVersion,
      profilePatch: { goal: 'branch_fit' },
      metaByPath: { goal: { source: 'button' } },
      turnId: 'compat-pins',
      conversationPins: { lastAsk: 'rank' },
    });

    assert.equal(outcome.ok, true);
    assert.ok(
      outcome.warnings.some((w) => w.field === 'lastAsk' && w.reason === 'not_in_profile_schema'),
      'conversation pins are outside the M-1 profile contract and must be reported'
    );
  });

  test('loadLeadProfile decodes slotMeta and exposes the derived read views', async () => {
    await api.casUpdateLeadProfile({
      phone: (await api.ensureLeadProfile(PHONE)).phone,
      expectedVersion: 0,
      profilePatch: {
        collegeOfInterestList: ['CMR', 'Anurag'],
        examResults: [{ exam: 'TS_EAMCET', attemptYear: 2026, rank: 9000, isPrimary: true }],
      },
      metaByPath: {
        collegeOfInterestList: { source: 'typed', verbatimQuote: 'cmr and anurag' },
        examResults: { source: 'extracted', verbatimQuote: 'ts eamcet 9000' },
      },
      turnId: 'compat-4',
    });

    const loaded = await api.loadLeadProfile(PHONE);
    assert.deepEqual(loaded.readViews.collegeOfInterestList, ['CMR', 'Anurag']);
    assert.equal(loaded.readViews.primaryExamResult.exam, 'TS_EAMCET');
    assert.equal(loaded.slotMeta.collegeOfInterestList.source, 'typed');
    assert.equal(loaded.profile.collegeOfInterest, 'CMR, Anurag', 'companion mirrors one-way to the legacy string');
  });

  test('ensureLeadProfile seeds through the same merge path and is idempotent', async () => {
    const seeded = await api.ensureLeadProfile(PHONE, { profile: { goal: 'branch_fit' }, academicYear: 2027 });
    assert.equal(seeded.profile.goal, 'branch_fit');
    assert.equal(seeded.academicYear, 2027);

    const again = await api.ensureLeadProfile(PHONE);
    assert.equal(again.profile.goal, 'branch_fit');
    assert.equal(await FlowV3LeadProfile.countDocuments({ phone: PHONE }), 1);
  });
});
