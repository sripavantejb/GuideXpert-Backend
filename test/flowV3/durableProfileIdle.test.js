'use strict';

/**
 * B-7: idle-survival proof against an in-memory Mongo.
 *
 * Never reads MONGODB_URI / MONGO_URI. FLOW_V3_REQUIRE_MONGO=1 is reserved for
 * CI to force a hard failure if this file somehow skips; with the memory
 * server below, a skip is no longer reachable under a healthy install of
 * mongodb-memory-server.
 */

require('../../config/mongooseSafety');

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const FlowV3LeadProfile = require('../../models/FlowV3LeadProfile');
const { emptyFlowV3Profile } = require('../../constants/flowV3/flowV3LeadProfileSchema');
const {
  ensureLeadProfile,
  loadLeadProfile,
  profileCollectionHasTtlIndex,
} = require('../../services/chatbot/flowV3LLM/profile');

let memory;

describe('durable profile survives idle (no TTL)', () => {
  before(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });

  after(async () => {
    try {
      await FlowV3LeadProfile.deleteMany({ phone: /^999000/ });
    } catch {
      /* ignore */
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (memory) await memory.stop();
  });

  test('schema has no TTL; saved profile remains loadable after simulated 30-minute idle', async () => {
    assert.equal(profileCollectionHasTtlIndex(), false);
    assert.equal(mongoose.connection.readyState, 1, 'expected an in-memory Mongo connection');

    const phone = '9990001234';
    await FlowV3LeadProfile.deleteMany({ phone });

    const profile = emptyFlowV3Profile();
    profile.goal = 'engineering';
    profile.examType = 'ts_eamcet';
    profile.rank = 4242;

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    await FlowV3LeadProfile.create({
      phone,
      schemaVersion: 1,
      profile,
      slotMeta: {
        goal: {
          source: 'typed',
          verbatimQuote: 'engineering',
          setAt: thirtyMinutesAgo,
        },
      },
      firstSeenAt: thirtyMinutesAgo,
      lastSeenAt: thirtyMinutesAgo,
    });

    const loaded = await loadLeadProfile(phone);
    assert.ok(loaded);
    assert.equal(loaded.profile.goal, 'engineering');
    assert.equal(loaded.profile.rank, 4242);

    const liveKeys = Object.keys(emptyFlowV3Profile()).filter((k) =>
      Object.prototype.hasOwnProperty.call(
        require('../../constants/careerCounsellingFlowV2Profile').LEAD_PROFILE_SCHEMA,
        k
      )
    );
    for (const key of liveKeys) {
      assert.ok(key in loaded.profile, `slot ${key} missing after idle`);
    }

    await ensureLeadProfile(phone);
    const again = await loadLeadProfile(phone);
    assert.equal(again.profile.goal, 'engineering');

    const liveIndexes = await FlowV3LeadProfile.collection.indexes();
    assert.equal(
      liveIndexes.some((i) => i.expireAfterSeconds != null),
      false,
      'live collection must not carry a TTL index'
    );
  });
});
