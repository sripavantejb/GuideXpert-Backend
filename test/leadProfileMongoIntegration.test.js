'use strict';

const { after, before, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PHONE = '9111111111';
const CONVERSATION_ID = new mongoose.Types.ObjectId();

let memoryServer;

async function connectMemoryMongo() {
  require('../models/WhatsAppLeadProfile');
  require('../models/WhatsAppLeadScore');
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri(), {
    dbName: 'lead_profile_mongo_integration',
    serverSelectionTimeoutMS: 10000,
  });
  await mongoose.model('WhatsAppLeadProfile').syncIndexes();
  await mongoose.model('WhatsAppLeadScore').syncIndexes();
}

async function disconnectMemoryMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

function loadProfileService() {
  const paths = [
    require.resolve('../services/chatbot/leadProfile/leadProfileService'),
    require.resolve('../services/chatbot/leadProfile/leadProfileConstants'),
    require.resolve('../services/chatbot/leadProfile/leadProfileFlags'),
    require.resolve('../services/chatbot/leadScoring/leadScoringService'),
    require.resolve('../services/chatbot/leadScoring/leadScoringFlags'),
  ];
  for (const path of paths) {
    delete require.cache[path];
  }
  return require('../services/chatbot/leadProfile/leadProfileService');
}

describe('leadProfile Mongo integration', () => {
  before(async () => {
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '1';
    await connectMemoryMongo();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '1';
  });

  after(async () => {
    delete process.env.CHATBOT_LEAD_PROFILE_ENABLED;
    delete process.env.CHATBOT_LEAD_SCORING_ENABLED;
    await disconnectMemoryMongo();
  });

  test('creates profile with assistantType ice without Mongo operator conflicts', async () => {
    const { updateProfile } = loadProfileService();
    const profile = await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'branch_preference', value: 'CSE', confidence: 0.9, evidence: 'CSE' }],
      assistantType: 'ice',
    });

    assert.ok(profile);
    assert.equal(profile.phone, PHONE);
    assert.equal(profile.branchInterest, 'CSE');
    assert.equal(profile.eventCount, 1);
    assert.deepEqual(profile.assistantTypesUsed, ['ice']);
    assert.ok(profile.firstInteractionAt instanceof Date);
  });

  test('increments eventCount across multiple updates', async () => {
    const { updateProfile } = loadProfileService();

    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'exam_mentioned', value: 'JEE', confidence: 0.9, evidence: 'JEE' }],
      assistantType: 'ice',
    });
    const second = await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'handoff_requested', value: 'counsellor', confidence: 0.9, evidence: 'handoff' }],
      assistantType: 'ice',
    });

    assert.equal(second.eventCount, 2);
    assert.equal(second.handoffRequested, true);
    assert.equal(second.exam, 'JEE');
  });

  test('deduplicates assistantTypesUsed with $addToSet', async () => {
    const { updateProfile } = loadProfileService();
    const WhatsAppLeadProfile = require('../models/WhatsAppLeadProfile');

    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'branch_preference', value: 'CSE', confidence: 0.9, evidence: 'CSE' }],
      assistantType: 'ice',
    });
    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'exam_mentioned', value: 'JEE', confidence: 0.9, evidence: 'JEE' }],
      assistantType: 'ice',
    });
    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'demo_interest', value: 'yes', confidence: 0.9, evidence: 'demo' }],
      assistantType: 'cpa',
    });

    const profile = await WhatsAppLeadProfile.findOne({ phone: PHONE }).lean();
    assert.deepEqual(profile.assistantTypesUsed.sort(), ['cpa', 'ice']);
    assert.equal(profile.eventCount, 3);
  });

  test('buildProfileUpdateOps has no conflicting paths in $setOnInsert', () => {
    const { buildProfileUpdateOps } = require('../services/chatbot/leadProfile/leadProfileConstants');
    const update = buildProfileUpdateOps({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'branch_preference', value: 'CSE' }],
      assistantType: 'ice',
    });

    assert.equal(update.$setOnInsert.assistantTypesUsed, undefined);
    assert.equal(update.$setOnInsert.eventCount, undefined);
    assert.equal(update.$setOnInsert.demoInterested, undefined);
    assert.equal(update.$setOnInsert.priceSensitive, undefined);
    assert.equal(update.$setOnInsert.handoffRequested, undefined);
    assert.equal(update.$inc.eventCount, 1);
    assert.equal(update.$addToSet.assistantTypesUsed, 'ice');
    const booleanPaths = new Set(Object.values(require('../services/chatbot/leadProfile/leadProfileConstants').BOOLEAN_FIELD_BY_EVENT_TYPE));
    for (const path of booleanPaths) {
      assert.equal(update.$setOnInsert[path], undefined, `$setOnInsert must not include ${path}`);
    }
  });
});
