'use strict';

const MAX_LEAD_SCORE = 100;

const LEAD_STAGES = Object.freeze({
  COLD: 'cold',
  WARM: 'warm',
  HOT: 'hot',
});

const SCORE_RULES = Object.freeze([
  {
    reason: 'exam_mentioned',
    points: 10,
    applies(profile) {
      return Boolean(String(profile?.exam || '').trim());
    },
  },
  {
    reason: 'branch_preference',
    points: 10,
    applies(profile) {
      return Boolean(String(profile?.branchInterest || '').trim());
    },
  },
  {
    reason: 'college_preference',
    points: 10,
    applies(profile) {
      return Boolean(String(profile?.collegeInterest || '').trim());
    },
  },
  {
    reason: 'demo_interest',
    points: 25,
    applies(profile) {
      return profile?.demoInterested === true;
    },
  },
  {
    reason: 'handoff_requested',
    points: 30,
    applies(profile) {
      return profile?.handoffRequested === true;
    },
  },
  {
    reason: 'price_sensitivity',
    points: 5,
    applies(profile) {
      return profile?.priceSensitive === true;
    },
  },
  {
    reason: 'multi_assistant_engagement',
    points: 5,
    applies(profile) {
      return Array.isArray(profile?.assistantTypesUsed) && profile.assistantTypesUsed.length > 2;
    },
  },
  {
    reason: 'high_event_count',
    points: 10,
    applies(profile) {
      return Number(profile?.eventCount || 0) > 10;
    },
  },
]);

function computeLeadConfidence(eventCount = 0) {
  return Math.min(0.99, 0.5 + Number(eventCount || 0) * 0.03);
}

function resolveLeadStage(leadScore) {
  const score = Number(leadScore || 0);
  if (score <= 30) {
    return LEAD_STAGES.COLD;
  }
  if (score <= 70) {
    return LEAD_STAGES.WARM;
  }
  return LEAD_STAGES.HOT;
}

function computeLeadScore(profile = {}) {
  let leadScore = 0;
  const scoreReasons = [];

  for (const rule of SCORE_RULES) {
    if (rule.applies(profile)) {
      leadScore += rule.points;
      scoreReasons.push(rule.reason);
    }
  }

  leadScore = Math.min(MAX_LEAD_SCORE, leadScore);
  const leadStage = resolveLeadStage(leadScore);
  const confidence = computeLeadConfidence(profile?.eventCount);

  return {
    leadScore,
    leadStage,
    scoreReasons,
    confidence,
  };
}

function buildLeadScoreUpdateOps({ phone, conversationId, profile, now = new Date() } = {}) {
  const scored = computeLeadScore(profile);

  return {
    $set: {
      phone,
      conversationId,
      leadScore: scored.leadScore,
      leadStage: scored.leadStage,
      scoreReasons: scored.scoreReasons,
      confidence: scored.confidence,
      lastScoredAt: now,
    },
    $setOnInsert: {
      firstScoredAt: now,
      metadata: {},
    },
  };
}

module.exports = {
  MAX_LEAD_SCORE,
  LEAD_STAGES,
  SCORE_RULES,
  computeLeadConfidence,
  resolveLeadStage,
  computeLeadScore,
  buildLeadScoreUpdateOps,
};
