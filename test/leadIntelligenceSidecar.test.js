'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLeadScoreFromProfile,
  stageFromScore,
} = require('../services/chatbot/leadIntelligence/leadScoreFromProfile');
const { computeNoReplyFields } = require('../services/chatbot/leadInsights/leadInsightsService');

test('stageFromScore bands match product rules', () => {
  assert.equal(stageFromScore(0), 'cold');
  assert.equal(stageFromScore(30), 'cold');
  assert.equal(stageFromScore(31), 'warm');
  assert.equal(stageFromScore(70), 'warm');
  assert.equal(stageFromScore(71), 'hot');
});

test('computeLeadScoreFromProfile awards points for profile facts', () => {
  const result = computeLeadScoreFromProfile(
    {
      name: 'Ravi',
      exam: 'TS EAMCET',
      branchInterest: 'CSE',
      escalate_human: true,
    },
    { messageCount: 12 }
  );
  assert.ok(result.leadScore >= 55);
  assert.ok(['warm', 'hot'].includes(result.leadStage));
  assert.ok(result.scoreReasons.includes('exam_mentioned'));
  assert.ok(result.scoreReasons.includes('handoff_requested'));
  assert.ok(result.scoreReasons.includes('high_engagement'));
});

test('computeNoReplyFields detects awaiting reply', () => {
  const now = new Date('2026-08-03T12:00:00.000Z');
  const fields = computeNoReplyFields(
    {
      _id: 'abc',
      lastInboundAt: new Date('2026-08-03T11:50:00.000Z'),
      lastOutboundAt: new Date('2026-08-03T11:40:00.000Z'),
    },
    now
  );
  assert.equal(fields.awaitingReply, true);
  assert.equal(fields.noReplyMs, 10 * 60 * 1000);
  assert.ok(fields.conversationId);
});

test('computeNoReplyFields false when outbound is newer', () => {
  const now = new Date('2026-08-03T12:00:00.000Z');
  const fields = computeNoReplyFields(
    {
      _id: 'abc',
      lastInboundAt: new Date('2026-08-03T11:40:00.000Z'),
      lastOutboundAt: new Date('2026-08-03T11:50:00.000Z'),
    },
    now
  );
  assert.equal(fields.awaitingReply, false);
  assert.equal(fields.noReplyMs, null);
});
