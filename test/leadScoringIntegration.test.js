'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const profileServicePath = require.resolve('../services/chatbot/leadProfile/leadProfileService');
const scoringServicePath = require.resolve('../services/chatbot/leadScoring/leadScoringService');
const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const profileModelPath = require.resolve('../models/WhatsAppLeadProfile');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

describe('lead scoring integration at profile boundary', () => {
  const originalEnv = {
    profile: process.env.CHATBOT_LEAD_PROFILE_ENABLED,
    scoring: process.env.CHATBOT_LEAD_SCORING_ENABLED,
  };

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[profileServicePath];
    delete require.cache[scoringServicePath];
    delete require.cache[logPath];

    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey = key === 'profile' ? 'CHATBOT_LEAD_PROFILE_ENABLED' : 'CHATBOT_LEAD_SCORING_ENABLED';
      if (value === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = value;
      }
    }
  });

  function setupProfileMocks({ scoringImpl } = {}) {
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '1';

    const WhatsAppLeadProfile = require(profileModelPath);
    const profileDoc = {
      _id: new mongoose.Types.ObjectId(),
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      branchInterest: 'CSE',
      exam: 'JEE',
      demoInterested: true,
      handoffRequested: true,
      priceSensitive: true,
      eventCount: 14,
      assistantTypesUsed: ['ice'],
    };
    mock.method(WhatsAppLeadProfile, 'findOneAndUpdate', async () => profileDoc);

    delete require.cache[logPath];
    const logModule = require(logPath);
    mock.method(logModule, 'logChatbotEvent', () => {});

    delete require.cache[scoringServicePath];
    const scoringService = require(scoringServicePath);
    const scoringCalls = [];
    mock.method(scoringService, 'updateLeadScore', async (args) => {
      scoringCalls.push(args);
      if (scoringImpl) {
        return scoringImpl(args);
      }
      return { leadScore: 90, leadStage: 'hot' };
    });

    delete require.cache[profileServicePath];
    const { updateProfile } = require(profileServicePath);

    return { updateProfile, scoringCalls, profileDoc };
  }

  test('calls updateLeadScore after successful profile update when both flags on', async () => {
    const { updateProfile, scoringCalls, profileDoc } = setupProfileMocks();

    await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'demo_interest', value: 'yes', confidence: 0.9, evidence: 'demo' }],
      assistantType: 'ice',
      inboundMessageId: INBOUND_ID,
    });

    assert.equal(scoringCalls.length, 1);
    assert.equal(scoringCalls[0].profile.phone, profileDoc.phone);
    assert.equal(scoringCalls[0].profile.eventCount, 14);
    assert.equal(String(scoringCalls[0].inboundMessageId), String(INBOUND_ID));
  });

  test('skips updateLeadScore when scoring flag is off', async () => {
    const { updateProfile, scoringCalls } = setupProfileMocks();
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '0';
    delete require.cache[profileServicePath];
    const { updateProfile: updateProfileReloaded } = require(profileServicePath);

    const result = await updateProfileReloaded({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'exam_mentioned', value: 'JEE', confidence: 0.9, evidence: 'JEE' }],
      assistantType: 'ice',
    });

    assert.ok(result);
    assert.equal(scoringCalls.length, 0);
  });

  test('profile update succeeds when updateLeadScore rejects', async () => {
    const { updateProfile } = setupProfileMocks({
      scoringImpl: async () => {
        throw new Error('score write failed');
      },
    });

    const result = await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'handoff_requested', value: 'yes', confidence: 0.95, evidence: 'counsellor' }],
      assistantType: 'ice',
    });

    assert.ok(result);
    assert.equal(result.phone, PHONE);
  });

  test('profile flag off behavior unchanged', async () => {
    process.env.CHATBOT_LEAD_PROFILE_ENABLED = '0';
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '1';

    delete require.cache[scoringServicePath];
    const scoringService = require(scoringServicePath);
    let scoringCalled = false;
    mock.method(scoringService, 'updateLeadScore', async () => {
      scoringCalled = true;
      return null;
    });

    delete require.cache[profileServicePath];
    const { updateProfile } = require(profileServicePath);
    const result = await updateProfile({
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      events: [{ type: 'exam_mentioned', value: 'JEE', confidence: 0.9, evidence: 'JEE' }],
    });

    assert.equal(result, null);
    assert.equal(scoringCalled, false);
  });
});
