'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotSummaryV2Service');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const providerPath = require.resolve('../services/ai/providers/OpenAiCompatibleProvider');
const flagsPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFlags');

const HANDOFF_ID = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();

describe('humanCopilotSummaryV2Service', () => {
  const originalSuggest = process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED;
  const originalLlmKey = process.env.LLM_API_KEY;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[flagsPath];
    if (originalSuggest === undefined) delete process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED;
    else process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = originalSuggest;
    if (originalLlmKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalLlmKey;
  });

  function richContext() {
    return {
      handoff: {
        _id: HANDOFF_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
        reason: 'user_requested',
        userLastMessage: 'Tell me about scholarships',
        summaryForAgent: 'IIT counselling lead from Telangana',
        internalNotes: [{ text: 'Asked about hostel earlier' }],
        auditTrail: [{ action: 'resolved', at: new Date() }],
      },
      leadDetails: {
        profile: {
          branchInterest: 'CSE',
          collegeInterest: 'IIT Hyderabad',
          exam: 'JEE',
          languagePreference: 'Telugu',
          priceSensitive: true,
        },
        score: { leadScore: 84, leadStage: 'hot', confidence: 0.92, lastScoredAt: new Date() },
        recentEvents: [
          {
            createdAt: new Date(),
            events: [
              { type: 'program_interest', value: 'CSE', confidence: 0.9 },
              { type: 'rank_mentioned', value: '15000', confidence: 0.85 },
              { type: 'price_sensitivity', value: 'yes', confidence: 0.8 },
            ],
          },
        ],
      },
      transcript: {
        messages: [
          { id: 'm1', direction: 'in', text: 'Need scholarship info', at: new Date() },
          { id: 'm2', direction: 'out', text: 'Happy to help', at: new Date(), senderType: 'bot' },
        ],
      },
      leadContext: {
        iit: { slotBooking: 'Wednesday 6PM', preferredLanguage: 'Telugu', city: 'Hyderabad' },
        gx: null,
      },
      iitExtras: {
        stream: 'MPC',
        city: 'Telangana',
        studentOrParent: 'Parent',
        topColleges: 'IIT Hyderabad',
      },
      priorHandoffs: [{ status: 'resolved', reason: 'user_requested', isReopened: false }],
    };
  }

  test('complete profile populates all structured sections', () => {
    const { buildStructuredSummaryFromRules, NOT_COLLECTED } = require(servicePath);
    const summary = buildStructuredSummaryFromRules(richContext());

    assert.match(summary.studentGoal, /CSE/i);
    assert.ok(summary.currentConcern);
    assert.notEqual(summary.currentConcern, NOT_COLLECTED);
    assert.equal(summary.importantFacts.stream, 'MPC');
    assert.equal(summary.importantFacts.language, 'Telugu');
    assert.equal(summary.leadQuality.score, '84');
    assert.equal(summary.leadQuality.stage, 'hot');
    assert.match(summary.previousInteractions, /handoff/i);
    assert.ok(summary.recommendedNextAction);
  });

  test('partial profile uses Unknown and Not yet collected placeholders', () => {
    const { buildStructuredSummaryFromRules, UNKNOWN, NOT_COLLECTED } = require(servicePath);
    const summary = buildStructuredSummaryFromRules({
      handoff: { _id: HANDOFF_ID, userLastMessage: 'Hello' },
      leadDetails: { profile: { exam: 'JEE' }, score: null, recentEvents: [] },
      transcript: { messages: [{ id: 'a', direction: 'in', text: 'Hi', at: new Date() }] },
      leadContext: null,
      priorHandoffs: [],
      iitExtras: null,
    });

    assert.equal(summary.importantFacts.stream, NOT_COLLECTED);
    assert.equal(summary.importantFacts.parentInvolvement, UNKNOWN);
    assert.equal(summary.leadQuality.score, NOT_COLLECTED);
    assert.ok(summary.studentGoal);
  });

  test('no lead score section uses not-collected placeholders', () => {
    const { buildStructuredSummaryFromRules, NOT_COLLECTED } = require(servicePath);
    const summary = buildStructuredSummaryFromRules({
      handoff: { _id: HANDOFF_ID },
      leadDetails: { profile: {}, score: null, recentEvents: [] },
      transcript: { messages: [] },
      priorHandoffs: [],
    });
    assert.equal(summary.leadQuality.score, NOT_COLLECTED);
    assert.equal(summary.leadQuality.stage, NOT_COLLECTED);
    assert.equal(summary.leadQuality.confidence, NOT_COLLECTED);
  });

  test('missing events still derives goal and concern from profile and last message', () => {
    const { buildStructuredSummaryFromRules } = require(servicePath);
    const summary = buildStructuredSummaryFromRules({
      handoff: {
        _id: HANDOFF_ID,
        userLastMessage: 'What about hostel facilities?',
      },
      leadDetails: {
        profile: { branchInterest: 'ECE' },
        score: { leadScore: 50, leadStage: 'warm', confidence: 0.7 },
        recentEvents: [],
      },
      transcript: {
        messages: [{ id: 'x', direction: 'in', text: 'Hostel facilities?', at: new Date() }],
      },
      priorHandoffs: [],
    });
    assert.match(summary.studentGoal, /ECE/i);
    assert.match(summary.currentConcern, /hostel/i);
  });

  test('long transcript uses recent messages without throwing', () => {
    const { buildStructuredSummaryFromRules } = require(servicePath);
    const messages = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`,
      direction: i % 2 === 0 ? 'in' : 'out',
      text: `Message number ${i} with some counselling context about fees`,
      at: new Date(Date.now() - (200 - i) * 1000),
    }));
    const summary = buildStructuredSummaryFromRules({
      handoff: { _id: HANDOFF_ID },
      leadDetails: { profile: {}, score: null, recentEvents: [] },
      transcript: { messages },
      priorHandoffs: [],
    });
    assert.ok(summary.currentConcern.length <= 200);
    assert.ok(summary.studentGoal);
  });

  test('caching returns stored summary when cache key matches', async () => {
    process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = '0';
    const ctx = richContext();
    const {
      buildSummaryCacheKey,
      buildStructuredSummaryFromRules,
      ensureStructuredSummary,
    } = require(servicePath);

    const rules = buildStructuredSummaryFromRules(ctx);
    const cacheKey = buildSummaryCacheKey({
      handoffId: HANDOFF_ID,
      transcript: ctx.transcript,
      internalNotesCount: 1,
      leadScore: ctx.leadDetails.score,
      eventCount: 3,
    });

    const WhatsAppAgentHandoff = require(handoffModelPath);
    let updateCalled = false;
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => {
      updateCalled = true;
    });

    const handoff = {
      _id: HANDOFF_ID,
      internalNotes: ctx.handoff.internalNotes,
      copilotStructuredSummary: rules,
      copilotSummaryCacheKey: cacheKey,
      copilotAiSummary: 'cached text',
    };

    const result = await ensureStructuredSummary(handoff, ctx);
    assert.equal(result.summaryCached, true);
    assert.equal(result.structuredSummary.studentGoal, rules.studentGoal);
    assert.equal(updateCalled, false);
  });

  test('cache miss regenerates when last message changes', async () => {
    process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED = '0';
    const ctx = richContext();
    const { buildSummaryCacheKey, ensureStructuredSummary } = require(servicePath);

    const oldKey = buildSummaryCacheKey({
      handoffId: HANDOFF_ID,
      transcript: ctx.transcript,
      internalNotesCount: 1,
      leadScore: ctx.leadDetails.score,
      eventCount: 3,
    });

    ctx.transcript.messages.push({
      id: 'm-new',
      direction: 'in',
      text: 'New scholarship question',
      at: new Date(),
    });
    const newKey = buildSummaryCacheKey({
      handoffId: HANDOFF_ID,
      transcript: ctx.transcript,
      internalNotesCount: 1,
      leadScore: ctx.leadDetails.score,
      eventCount: 3,
    });
    assert.notEqual(oldKey, newKey);

    const WhatsAppAgentHandoff = require(handoffModelPath);
    let updateCalled = false;
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => {
      updateCalled = true;
    });

    const handoff = {
      _id: HANDOFF_ID,
      internalNotes: ctx.handoff.internalNotes,
      copilotStructuredSummary: { studentGoal: 'old' },
      copilotSummaryCacheKey: oldKey,
    };

    const result = await ensureStructuredSummary(handoff, ctx);
    assert.equal(result.summaryCached, false);
    assert.equal(updateCalled, true);
    assert.notEqual(result.structuredSummary.studentGoal, 'old');
  });
});
