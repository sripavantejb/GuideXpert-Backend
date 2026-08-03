'use strict';

/**
 * Deterministic lead score from LLM-only BotState.leadProfile + engagement.
 * No extra LLM call — additive sidecar for Lead Intelligence only.
 */

const POINT_RULES = [
  { key: 'exam', points: 10, reason: 'exam_mentioned' },
  { key: 'branchInterest', points: 10, reason: 'branch_preference' },
  { key: 'course_interest', points: 10, reason: 'course_interest' },
  { key: 'city_pref', points: 5, reason: 'city_preference' },
  { key: 'budget', points: 5, reason: 'budget_shared' },
  { key: 'rank', points: 10, reason: 'rank_shared' },
  { key: 'name', points: 5, reason: 'name_known' },
  { key: 'qualification', points: 5, reason: 'qualification_shared' },
];

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v && v !== 'false' && v !== '0' && v !== 'no' && v !== 'none' && v !== 'null';
  }
  return false;
}

function stageFromScore(score) {
  if (score <= 30) return 'cold';
  if (score <= 70) return 'warm';
  return 'hot';
}

/**
 * @param {object} leadProfile - sanitized BotState.context.leadProfile
 * @param {{ messageCount?: number }} engagement
 * @returns {{ leadScore: number, leadStage: string, scoreReasons: string[], confidence: number }}
 */
function computeLeadScoreFromProfile(leadProfile = {}, engagement = {}) {
  const profile = leadProfile && typeof leadProfile === 'object' ? leadProfile : {};
  let score = 0;
  const reasons = [];

  for (const rule of POINT_RULES) {
    if (hasValue(profile[rule.key])) {
      score += rule.points;
      reasons.push(rule.reason);
    }
  }

  // collegeInterest may live as shortlist / best_match in LLM profile
  if (hasValue(profile.shortlist) || hasValue(profile.best_match)) {
    score += 10;
    reasons.push('college_preference');
  }

  if (isTruthyFlag(profile.handoff_status) || isTruthyFlag(profile.escalate_human)) {
    score += 30;
    reasons.push('handoff_requested');
  }

  if (isTruthyFlag(profile.booking_status)) {
    score += 25;
    reasons.push('demo_interest');
  }

  // Map LLM temperature/stage hints into extra points (still deterministic)
  const temp = String(profile.temperature || '').trim().toLowerCase();
  if (temp === 'hot' || temp === 'high') {
    score += 15;
    reasons.push('temperature_hot');
  } else if (temp === 'warm' || temp === 'medium') {
    score += 8;
    reasons.push('temperature_warm');
  }

  const stageHint = String(profile.stage || '').trim().toLowerCase();
  if (stageHint.includes('book') || stageHint.includes('demo') || stageHint.includes('ready')) {
    score += 10;
    reasons.push('stage_ready');
  }

  const messageCount = Number(engagement.messageCount) || 0;
  if (messageCount > 10) {
    score += 10;
    reasons.push('high_engagement');
  } else if (messageCount > 4) {
    score += 5;
    reasons.push('moderate_engagement');
  }

  const leadScore = Math.max(0, Math.min(100, score));
  const factCount = reasons.length;
  const confidence = Math.min(0.99, 0.5 + factCount * 0.03);

  return {
    leadScore,
    leadStage: stageFromScore(leadScore),
    scoreReasons: [...new Set(reasons)],
    confidence,
  };
}

module.exports = {
  computeLeadScoreFromProfile,
  stageFromScore,
  POINT_RULES,
};
