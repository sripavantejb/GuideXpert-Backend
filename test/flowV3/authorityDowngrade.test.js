'use strict';

/**
 * F-6 hardening regression — authority downgrade guard (S-1).
 *
 * Found while verifying the F-1/F-6 interaction: `examType` is llmWritable in
 * the schema contract (unlike gender/category, which are Tier 3), so an
 * inferred LLM write could overwrite the student's own authoritative
 * "I wrote AP EAMCET" — silently un-arming the AP-OC-male gate. The store now
 * rejects any non-authoritative write over an authoritative slot value with
 * WRITE_AUTHORITY_DOWNGRADE.
 */

require('../../config/mongooseSafety');

const { after, before, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PHONE = '9876543210';

let memoryServer;
let FlowV3LeadProfile;
let profileApi;

describe('F-6 hardening: authority downgrade guard', () => {
  before(async () => {
    FlowV3LeadProfile = require('../../models/FlowV3LeadProfile');
    profileApi = require('../../services/chatbot/flowV3LLM/profile');
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(), {
      dbName: 'flow_v3_authority_downgrade',
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

  async function seedAuthoritativeExam() {
    const seeded = await profileApi.ensureLeadProfile(PHONE, {});
    const write = await profileApi.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: seeded.casVersion,
      profilePatch: { examType: 'AP_EAMCET' },
      metaByPath: { examType: { source: 'extracted', verbatimQuote: 'I wrote AP EAMCET' } },
      channel: 'extractor',
      turnId: 't_seed',
    });
    assert.equal(write.ok, true);
    return profileApi.loadLeadProfile(PHONE);
  }

  test('an inferred LLM write CANNOT replace an authoritative examType', async () => {
    const doc = await seedAuthoritativeExam();
    const flip = await profileApi.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: doc.casVersion,
      profilePatch: { examType: 'JEE_MAIN' },
      metaByPath: {
        examType: { source: 'inferred', confidence: 0.9, verbatimQuote: 'maybe jee' },
      },
      enforceLlmAllowlist: true,
      turnId: 't_flip',
    });
    assert.equal(flip.ok, false, 'the downgrade write must be a DENIED write');
    assert.ok(
      (flip.rejected || []).some(
        (r) => r.field === 'examType' && r.code === 'WRITE_AUTHORITY_DOWNGRADE'
      ),
      `expected WRITE_AUTHORITY_DOWNGRADE, got ${JSON.stringify(flip.rejected)}`
    );
    const fresh = await profileApi.loadLeadProfile(PHONE);
    assert.equal(fresh.profile.examType, 'AP_EAMCET', 'authoritative value must survive');
    assert.equal(fresh.slotMeta.examType.source, 'extracted', 'authoritative meta must survive');
  });

  test('the extractor CAN still correct a previously inferred value (upgrade allowed)', async () => {
    const seeded = await profileApi.ensureLeadProfile(PHONE, {});
    // LLM infers a wrong exam first (allowed on an empty slot)
    const inferredWrite = await profileApi.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: seeded.casVersion,
      profilePatch: { examType: 'JEE_MAIN' },
      metaByPath: { examType: { source: 'inferred', confidence: 0.7, verbatimQuote: 'jee?' } },
      enforceLlmAllowlist: true,
      turnId: 't_infer',
    });
    assert.equal(inferredWrite.ok, true, 'inferred write onto an EMPTY slot stays allowed');

    // The student then states the real exam — extractor overwrites the inference
    const doc = await profileApi.loadLeadProfile(PHONE);
    const correct = await profileApi.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: doc.casVersion,
      profilePatch: { examType: 'AP_EAMCET' },
      metaByPath: { examType: { source: 'extracted', verbatimQuote: 'I wrote AP EAMCET' } },
      channel: 'extractor',
      turnId: 't_correct',
    });
    assert.equal(correct.ok, true, 'authoritative correction must be allowed');
    const fresh = await profileApi.loadLeadProfile(PHONE);
    assert.equal(fresh.profile.examType, 'AP_EAMCET');
    assert.equal(fresh.slotMeta.examType.source, 'extracted');
  });

  test('authoritative-over-authoritative updates stay allowed (student changes answer)', async () => {
    const doc = await seedAuthoritativeExam();
    const change = await profileApi.casUpdateLeadProfile({
      phone: PHONE,
      expectedVersion: doc.casVersion,
      profilePatch: { examType: 'TS_EAMCET' },
      metaByPath: { examType: { source: 'extracted', verbatimQuote: 'sorry, TS EAMCET actually' } },
      channel: 'extractor',
      turnId: 't_change',
    });
    assert.equal(change.ok, true);
    const fresh = await profileApi.loadLeadProfile(PHONE);
    assert.equal(fresh.profile.examType, 'TS_EAMCET');
  });
});
