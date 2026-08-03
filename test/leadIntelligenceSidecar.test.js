'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLeadScoreFromProfile,
  stageFromScore,
} = require('../services/chatbot/leadIntelligence/leadScoreFromProfile');
const {
  computeNoReplyFields,
  mapAggregatedConversationRow,
  passesScoreFilters,
  sortListItems,
  parseActivityDate,
  conversationActivityAt,
  activityAtInIstDay,
  toIstDateKey,
  getIstDayRange,
} = require('../services/chatbot/leadInsights/leadInsightsService');

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

test('mapAggregatedConversationRow includes unscored conversation-only lead', () => {
  const item = mapAggregatedConversationRow({
    phone: '9876543210',
    conversation: {
      _id: 'conv1',
      phone: '9876543210',
      lastInboundAt: new Date('2026-08-03T11:00:00.000Z'),
      lastOutboundAt: null,
      messageCount: 3,
    },
    score: {},
    profile: {},
  });
  assert.equal(item.phone, '9876543210');
  assert.equal(item.leadScore, null);
  assert.equal(item.leadStage, null);
  assert.equal(item.conversationId, 'conv1');
  assert.equal(item.awaitingReply, true);
});

test('passesScoreFilters excludes unscored rows when stage filter active', () => {
  const unscored = { leadScore: null, leadStage: null };
  const warm = { leadScore: 55, leadStage: 'warm' };
  assert.equal(passesScoreFilters(unscored, { stage: 'warm' }), false);
  assert.equal(passesScoreFilters(warm, { stage: 'warm' }), true);
  assert.equal(passesScoreFilters(unscored, {}), true);
});

test('sortListItems prefers most recent inbound activity', () => {
  const sorted = sortListItems([
    { phone: '1111111111', lastInboundAt: '2026-08-01T10:00:00.000Z', leadScore: 90 },
    { phone: '2222222222', lastInboundAt: '2026-08-03T10:00:00.000Z', leadScore: 10 },
  ]);
  assert.equal(sorted[0].phone, '2222222222');
});

test('parseActivityDate accepts YYYY-MM-DD and rejects invalid', () => {
  assert.equal(parseActivityDate('2026-08-03').activityDate, '2026-08-03');
  assert.equal(parseActivityDate('').activityDate, null);
  assert.ok(parseActivityDate('08-03-2026').error);
  assert.ok(parseActivityDate('2026-13-01').error);
});

test('conversationActivityAt prefers lastInboundAt over updatedAt', () => {
  const inbound = new Date('2026-08-03T10:00:00.000Z');
  const updated = new Date('2026-08-04T10:00:00.000Z');
  const at = conversationActivityAt({ lastInboundAt: inbound, updatedAt: updated });
  assert.equal(at.toISOString(), inbound.toISOString());
  const fallback = conversationActivityAt({ lastInboundAt: null, updatedAt: updated });
  assert.equal(fallback.toISOString(), updated.toISOString());
});

test('activityAtInIstDay matches IST calendar day boundaries', () => {
  // 2026-08-03 00:30 IST = 2026-08-02 19:00 UTC
  const earlyIst = new Date('2026-08-02T19:00:00.000Z');
  assert.equal(activityAtInIstDay(earlyIst, '2026-08-03'), true);
  assert.equal(activityAtInIstDay(earlyIst, '2026-08-02'), false);
  assert.equal(toIstDateKey(earlyIst), '2026-08-03');

  const { start, end } = getIstDayRange('2026-08-03');
  assert.equal(start.toISOString(), '2026-08-02T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-08-03T18:30:00.000Z');
});

test('mapAggregatedConversationRow includes activityAt', () => {
  const item = mapAggregatedConversationRow({
    phone: '9876543210',
    conversation: {
      _id: 'conv1',
      phone: '9876543210',
      lastInboundAt: new Date('2026-08-03T11:00:00.000Z'),
      lastOutboundAt: null,
      messageCount: 3,
      updatedAt: new Date('2026-08-03T12:00:00.000Z'),
    },
    score: {},
    profile: {},
  });
  assert.equal(item.activityAt, '2026-08-03T11:00:00.000Z');
});
