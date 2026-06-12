'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/leadProfile/leadProfileService');
const constantsPath = require.resolve('../services/chatbot/leadProfile/leadProfileConstants');
const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const modelPath = require.resolve('../models/WhatsAppLeadProfile');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

describe('leadProfileService', () => {
  const originalProfileFlag = process.env.CHATBOT_LEAD_PROFILE_ENABLED;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[constantsPath];
    delete require.cache[logPath];

    if (originalProfileFlag === undefined) {
      delete process.env.CHATBOT_LEAD_PROFILE_ENABLED;
    } else {
      process.env.CHATBOT_LEAD_PROFILE_ENABLED = originalProfileFlag;
    }
  });

  function mockProfileDb({ profileDoc = null } = {}) {
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';

    const WhatsAppLeadProfile = require(modelPath);
    mock.method(WhatsAppLeadProfile, 'findOneAndUpdate', async (_filter, update) => ({
      _id: new mongoose.Types.ObjectId(),
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      eventCount: update?.$inc?.eventCount ?? 0,
      ...profileDoc,
    }));

    delete require.cache[logPath];
    const logModule = require(logPath);
    mock.method(logModule, 'logChatbotEvent', () => {});

    return { WhatsAppLeadProfile, logModule };
  }

  test('does nothing when feature flag is off', async () => {
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '0';
    const WhatsAppLeadProfile = require(modelPath);
    let called = false;
    mock.method(WhatsAppLeadProfile, 'findOneAndUpdate', async () => {
      called = true;
      return null;
    });

    const { updateProfile } = require(servicePath);
    const result = await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'exam_mentioned', value: 'JEE', confidence: 0.9, evidence: 'x' }],
      assistantType: 'ice',
    });

    assert.equal(result, null);
    assert.equal(called, false);
  });

  test('upserts profile on new phone with firstInteractionAt and eventCount', async () => {
    const { WhatsAppLeadProfile } = mockProfileDb();
    const events = [
      { type: 'exam_mentioned', value: 'JEE Advanced', confidence: 0.9, evidence: 'JEE' },
      { type: 'branch_preference', value: 'CSE', confidence: 0.85, evidence: 'CSE' },
    ];

    const { updateProfile } = require(servicePath);
    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events,
      assistantType: 'ice',
    });

    assert.equal(WhatsAppLeadProfile.findOneAndUpdate.mock.calls.length, 1);
    const [, update] = WhatsAppLeadProfile.findOneAndUpdate.mock.calls[0].arguments;
    assert.equal(update.$set.exam, 'JEE Advanced');
    assert.equal(update.$set.branchInterest, 'CSE');
    assert.equal(update.$inc.eventCount, 2);
    assert.ok(update.$setOnInsert.firstInteractionAt instanceof Date);
    assert.equal(update.$setOnInsert.assistantTypesUsed, undefined);
    assert.equal(update.$setOnInsert.eventCount, undefined);
    assert.equal(update.$addToSet.assistantTypesUsed, 'ice');
  });

  test('increments eventCount on existing profile update', async () => {
    const { WhatsAppLeadProfile } = mockProfileDb({ profileDoc: { eventCount: 3 } });
    const events = [{ type: 'college_preference', value: 'IIT Bombay', confidence: 0.9, evidence: 'IITB' }];

    const { updateProfile } = require(servicePath);
    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events,
      assistantType: 'unknown',
    });

    const [, update] = WhatsAppLeadProfile.findOneAndUpdate.mock.calls[0].arguments;
    assert.equal(update.$inc.eventCount, 1);
    assert.equal(update.$set.collegeInterest, 'IIT Bombay');
    assert.equal(update.$addToSet, undefined);
    assert.ok(update.$set.lastInteractionAt instanceof Date);
  });

  test('latest value wins for string fields in one batch', () => {
    const { applyEventsToProfileFields } = require(constantsPath);
    const fields = applyEventsToProfileFields([
      { type: 'branch_preference', value: 'ECE' },
      { type: 'branch_preference', value: 'CSE' },
    ]);
    assert.equal(fields.branchInterest, 'CSE');
  });

  test('sticky boolean flags are set true', () => {
    const { applyEventsToProfileFields } = require(constantsPath);
    const fields = applyEventsToProfileFields([
      { type: 'price_sensitivity', value: 'high' },
      { type: 'demo_interest', value: 'yes' },
      { type: 'handoff_requested', value: 'counsellor' },
    ]);
    assert.equal(fields.priceSensitive, true);
    assert.equal(fields.demoInterested, true);
    assert.equal(fields.handoffRequested, true);
  });

  test('buildProfileUpdateOps adds assistantType via $addToSet when not unknown', () => {
    const { buildProfileUpdateOps } = require(constantsPath);
    const now = new Date('2026-06-05T10:00:00Z');
    const update = buildProfileUpdateOps({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'rank_mentioned', value: '5000' }],
      assistantType: 'cpa',
      now,
    });
    assert.equal(update.$addToSet.assistantTypesUsed, 'cpa');
    assert.equal(update.$inc.eventCount, 1);
    assert.equal(update.$set.lastInteractionAt.getTime(), now.getTime());
  });

  test('logs lead_profile_updated on success', async () => {
    const { logModule } = mockProfileDb({ profileDoc: { eventCount: 5 } });

    const { updateProfile } = require(servicePath);
    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'language_preference', value: 'Hindi', confidence: 0.9, evidence: 'Hindi' }],
      assistantType: 'ka',
      inboundMessageId: new mongoose.Types.ObjectId(),
    });

    assert.equal(logModule.logChatbotEvent.mock.calls.length, 1);
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[0], 'lead_profile_updated');
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[1].eventCountDelta, 1);
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[1].profileEventCount, 5);
  });

  test('swallows DB errors without throwing', async () => {
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';
    const WhatsAppLeadProfile = require(modelPath);
    mock.method(WhatsAppLeadProfile, 'findOneAndUpdate', async () => {
      throw new Error('db down');
    });

    const { updateProfile } = require(servicePath);
    const result = await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'exam_mentioned', value: 'NEET', confidence: 0.9, evidence: 'NEET' }],
    });
    assert.equal(result, null);
  });
});
