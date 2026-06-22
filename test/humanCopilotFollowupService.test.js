'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFollowupService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const scoreModelPath = require.resolve('../models/WhatsAppLeadScore');
const replyPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotReplyService');

const HANDOFF_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
const FOLLOWUP_ID = new mongoose.Types.ObjectId();

describe('humanCopilotFollowupService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
  });

  function sampleHandoff(overrides = {}) {
    return {
      _id: HANDOFF_ID,
      conversationId: new mongoose.Types.ObjectId(),
      phone: '9876543210',
      route: 'admin_pool',
      status: 'claimed',
      copilotState: 'active',
      productLine: 'iit_counselling',
      userLastMessage: 'Need scholarship help',
      lockVersion: 2,
      copilotFollowups: [],
      copilotStructuredSummary: {
        studentGoal: 'CSE admissions',
        currentConcern: 'scholarship discussion',
      },
      updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  test('inactive lead generates reconnect follow-up', async () => {
    const handoff = sampleHandoff();
    const { buildRulesFollowup, detectInactiveScenario } = require(servicePath);
    const scenario = detectInactiveScenario(3, 4);
    const followup = buildRulesFollowup(scenario, {
      handoff,
      leadContext: { iit: { fullName: 'Ravi' } },
      leadDetails: { profile: { branchInterest: 'CSE' } },
    });
    assert.equal(followup.category, 'reconnect');
    assert.match(followup.suggestedMessage, /CSE/i);
    assert.equal(followup.recommendedDelayDays, 3);
  });

  test('hot lead scenario is high priority reconnect', () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const { detectHotLeadScenario } = require(servicePath);
    const scenario = detectHotLeadScenario({ leadScore: 85 }, 2, {
      copilotState: 'active',
      status: 'claimed',
    });
    assert.equal(scenario.priority, 'high');
    assert.equal(scenario.scenario, 'hot_lead_stalled');
  });

  test('booking reminder detects tomorrow session', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { detectBookingScenario } = require(servicePath);
    const scenario = detectBookingScenario({
      iit: { slotBookingDate: tomorrow.toISOString() },
    });
    assert.equal(scenario.scenario, 'booking_tomorrow');
    assert.equal(scenario.category, 'reminder');
  });

  test('missed session scenario maps to missed_session category', () => {
    const { detectMissedSession, buildRulesFollowup } = require(servicePath);
    const scenario = detectMissedSession({ iit: { demoStatusLabel: 'Missed demo' } });
    const followup = buildRulesFollowup(scenario, {
      handoff: sampleHandoff(),
      leadContext: { iit: { fullName: 'Anita' } },
      leadDetails: { profile: {} },
    });
    assert.equal(followup.category, 'missed_session');
    assert.match(followup.purpose, /missed/i);
  });

  test('skip suggestion marks follow-up skipped', async () => {
    const handoff = sampleHandoff({
      copilotFollowups: [
        {
          _id: FOLLOWUP_ID,
          category: 'reconnect',
          purpose: 'Reconnect',
          suggestedMessage: 'Hi',
          priority: 'medium',
          recommendedDelayDays: 3,
          status: 'suggested',
        },
      ],
    });
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({ lean: async () => handoff }));
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const { skipFollowup } = require(servicePath);
    const result = await skipFollowup(HANDOFF_ID, ADMIN_ID, { followupId: FOLLOWUP_ID });
    assert.equal(result.success, true);
    assert.ok(result.skippedAt);
  });

  test('sent suggestion delegates to sendCopilotReply', async () => {
    const handoff = sampleHandoff({
      copilotFollowups: [
        {
          _id: FOLLOWUP_ID,
          category: 'reconnect',
          purpose: 'Reconnect',
          suggestedMessage: 'Hi there',
          priority: 'high',
          recommendedDelayDays: 1,
          status: 'suggested',
        },
      ],
    });
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'findById', () => ({ lean: async () => handoff }));
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const replyService = require(replyPath);
    mock.method(replyService, 'sendCopilotReply', async () => ({
      success: true,
      deliveryStatus: 'sent',
      replyId: String(new mongoose.Types.ObjectId()),
      lockVersion: 3,
    }));

    delete require.cache[servicePath];
    const { sendFollowup } = require(servicePath);
    const result = await sendFollowup(HANDOFF_ID, ADMIN_ID, {
      followupId: FOLLOWUP_ID,
      message: 'Hi there',
      lockVersion: 2,
    });
    assert.equal(result.success, true);
    assert.equal(result.deliveryStatus, 'sent');
  });

  test('user reply after follow-up is detected for response tracking', () => {
    const { hasInboundAfter } = require(servicePath);
    const sentAt = new Date('2026-06-01T10:00:00Z');
    const transcript = {
      messages: [
        { direction: 'out', text: 'Follow-up', at: '2026-06-01T10:00:00Z' },
        { direction: 'in', text: 'Yes please', at: '2026-06-01T12:00:00Z' },
      ],
    };
    assert.equal(hasInboundAfter(transcript, sentAt), true);
  });

  test('AI unavailable still returns rules-based follow-up', async () => {
    delete process.env.LLM_API_KEY;
    const { generateFollowupSuggestion } = require(servicePath);
    const ctx = {
      handoff: sampleHandoff(),
      leadContext: { iit: { fullName: 'Priya' } },
      leadDetails: { profile: { branchInterest: 'CSE' } },
      scoreDoc: null,
      inactiveDays: 3,
      daysSinceReply: 5,
    };
    const result = await generateFollowupSuggestion(ctx, { useLlm: true });
    assert.ok(result);
    assert.equal(result.source, 'rules');
    assert.match(result.suggestedMessage, /CSE|guidance/i);
  });
});
