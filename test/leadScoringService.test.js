'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/leadScoring/leadScoringService');
const constantsPath = require.resolve('../services/chatbot/leadScoring/leadScoringConstants');
const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const modelPath = require.resolve('../models/WhatsAppLeadScore');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

describe('leadScoringService', () => {
  const originalScoringFlag = process.env.CHATBOT_LEAD_SCORING_ENABLED;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[constantsPath];
    delete require.cache[logPath];

    if (originalScoringFlag === undefined) {
      delete process.env.CHATBOT_LEAD_SCORING_ENABLED;
    } else {
      process.env.CHATBOT_LEAD_SCORING_ENABLED = originalScoringFlag;
    }
  });

  function exampleProfile(overrides = {}) {
    return {
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      branchInterest: 'CSE',
      exam: 'JEE',
      priceSensitive: true,
      demoInterested: true,
      handoffRequested: true,
      eventCount: 14,
      assistantTypesUsed: ['ice'],
      ...overrides,
    };
  }

  function mockScoreDb({ scoreDoc = null } = {}) {
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '1';

    const WhatsAppLeadScore = require(modelPath);
    mock.method(WhatsAppLeadScore, 'findOneAndUpdate', async (_filter, update) => ({
      _id: new mongoose.Types.ObjectId(),
      phone: PHONE,
      conversationId: CONVERSATION_ID,
      ...update.$set,
      ...scoreDoc,
    }));

    delete require.cache[logPath];
    const logModule = require(logPath);
    mock.method(logModule, 'logChatbotEvent', () => {});

    return { WhatsAppLeadScore, logModule };
  }

  test('does nothing when feature flag is off', async () => {
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '0';
    const WhatsAppLeadScore = require(modelPath);
    let called = false;
    mock.method(WhatsAppLeadScore, 'findOneAndUpdate', async () => {
      called = true;
      return null;
    });

    const { updateLeadScore } = require(servicePath);
    const result = await updateLeadScore({ profile: exampleProfile() });

    assert.equal(result, null);
    assert.equal(called, false);
  });

  test('creates score document on first profile scoring', async () => {
    const { WhatsAppLeadScore } = mockScoreDb();

    const { updateLeadScore } = require(servicePath);
    await updateLeadScore({ profile: exampleProfile() });

    assert.equal(WhatsAppLeadScore.findOneAndUpdate.mock.calls.length, 1);
    const [, update] = WhatsAppLeadScore.findOneAndUpdate.mock.calls[0].arguments;
    assert.equal(update.$set.leadScore, 90);
    assert.equal(update.$set.leadStage, 'hot');
    assert.ok(update.$setOnInsert.firstScoredAt instanceof Date);
    assert.ok(update.$set.lastScoredAt instanceof Date);
  });

  test('updates score on subsequent profile scoring', async () => {
    const { WhatsAppLeadScore } = mockScoreDb({
      scoreDoc: { leadScore: 40, leadStage: 'warm' },
    });

    const { updateLeadScore } = require(servicePath);
    await updateLeadScore({
      profile: exampleProfile({ handoffRequested: false, demoInterested: false, eventCount: 2 }),
    });

    const [, update] = WhatsAppLeadScore.findOneAndUpdate.mock.calls[0].arguments;
    assert.equal(update.$set.leadScore, 25);
    assert.equal(update.$set.leadStage, 'cold');
  });

  test('classifies cold warm and hot stages', () => {
    const { resolveLeadStage } = require(constantsPath);
    assert.equal(resolveLeadStage(0), 'cold');
    assert.equal(resolveLeadStage(30), 'cold');
    assert.equal(resolveLeadStage(31), 'warm');
    assert.equal(resolveLeadStage(70), 'warm');
    assert.equal(resolveLeadStage(71), 'hot');
    assert.equal(resolveLeadStage(100), 'hot');
  });

  test('computes confidence from eventCount', () => {
    const { computeLeadConfidence } = require(constantsPath);
    assert.equal(computeLeadConfidence(0), 0.5);
    assert.ok(Math.abs(computeLeadConfidence(14) - 0.92) < 0.0001);
    assert.equal(computeLeadConfidence(100), 0.99);
  });

  test('caps score at 100', () => {
    const { computeLeadScore } = require(constantsPath);
    const scored = computeLeadScore({
      exam: 'JEE',
      branchInterest: 'CSE',
      collegeInterest: 'IIT Bombay',
      demoInterested: true,
      handoffRequested: true,
      priceSensitive: true,
      assistantTypesUsed: ['ice', 'cpa', 'ka'],
      eventCount: 20,
    });
    assert.equal(scored.leadScore, 100);
    assert.equal(scored.leadStage, 'hot');
  });

  test('builds scoreReasons for matched rules', () => {
    const { computeLeadScore } = require(constantsPath);
    const scored = computeLeadScore(exampleProfile());
    assert.deepEqual(scored.scoreReasons, [
      'exam_mentioned',
      'branch_preference',
      'demo_interest',
      'handoff_requested',
      'price_sensitivity',
      'high_event_count',
    ]);
  });

  test('logs lead_score_updated on success', async () => {
    const { logModule } = mockScoreDb();

    const { updateLeadScore } = require(servicePath);
    await updateLeadScore({ profile: exampleProfile() });

    assert.equal(logModule.logChatbotEvent.mock.calls.length, 1);
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[0], 'lead_score_updated');
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[1].leadScore, 90);
    assert.equal(logModule.logChatbotEvent.mock.calls[0].arguments[1].leadStage, 'hot');
  });

  test('swallows DB errors without throwing', async () => {
    process.env.CHATBOT_LEAD_SCORING_ENABLED = '1';
    const WhatsAppLeadScore = require(modelPath);
    mock.method(WhatsAppLeadScore, 'findOneAndUpdate', async () => {
      throw new Error('db down');
    });

    const { updateLeadScore } = require(servicePath);
    const result = await updateLeadScore({ profile: exampleProfile() });
    assert.equal(result, null);
  });
});
