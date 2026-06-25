'use strict';

const LeadLifecycleEvent = require('../../models/LeadLifecycleEvent');
const LeadConversionPrediction = require('../../models/LeadConversionPrediction');
const WhatsAppLeadScore = require('../../models/WhatsAppLeadScore');
const WhatsAppLeadProfile = require('../../models/WhatsAppLeadProfile');
const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const { maxStage, rankStage, COPILOT_ASSIGNED_STATES } = require('../../constants/leadLifecycle');
const {
  RULES_VERSION,
  CACHE_TTL_MS,
  RISK_THRESHOLDS,
  PORTFOLIO_DEFAULT_LIMIT,
  PORTFOLIO_MAX_LIMIT,
  PREDICTION_RULES,
  CONFIDENCE_SIGNALS,
  SCORE_CONFIDENCE_HIGH_THRESHOLD,
  transitionKey,
  buildDefaultRatesMap,
  LIFECYCLE_STAGES,
} = require('../../constants/conversionPrediction');
const { getLifecycleFunnel } = require('./leadLifecycleFunnelService');
const { getFollowupEffectiveness } = require('./followupEffectivenessService');
const { getCounsellorPerformance } = require('./counsellorPerformanceService');
const { normalizePhone10 } = require('../chatbot/leadInsights/leadInsightsService');

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundPct(value) {
  return Math.round(clamp01(value) * 1000) / 10;
}

function daysSince(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function buildTransitionRatesFromFunnel(funnel = {}) {
  const rates = buildDefaultRatesMap();
  const stageCounts = funnel.stageCounts || {};
  const fromStages = funnel.stages || [];

  for (let i = 0; i < LIFECYCLE_STAGES.length - 1; i += 1) {
    const from = LIFECYCLE_STAGES[i];
    const to = LIFECYCLE_STAGES[i + 1];
    const fromCount = stageCounts[from] ?? fromStages.find((s) => s.stage === from)?.count ?? 0;
    const toCount = stageCounts[to] ?? fromStages.find((s) => s.stage === to)?.count ?? 0;
    if (fromCount > 0 && toCount >= 0) {
      rates[transitionKey(from, to)] = clamp01(toCount / fromCount);
    }
  }

  return rates;
}

function chainProbabilityFromStage(currentStage, targetStage, rates = {}) {
  const currentRank = rankStage(currentStage);
  const targetRank = rankStage(targetStage);
  if (currentRank < 0 || targetRank < 0) return 0;
  if (currentRank >= targetRank) return 1;

  let probability = 1;
  for (let i = currentRank; i < targetRank; i += 1) {
    const from = LIFECYCLE_STAGES[i];
    const to = LIFECYCLE_STAGES[i + 1];
    const step = rates[transitionKey(from, to)];
    probability *= step != null ? step : buildDefaultRatesMap()[transitionKey(from, to)] || 0.3;
  }
  return clamp01(probability);
}

function computeBaseProbabilities(ctx, rates) {
  const current = ctx.lifecycleMaxStage || 'lead';
  return {
    bookingProbability: chainProbabilityFromStage(current, 'booked', rates),
    attendanceProbability: chainProbabilityFromStage(current, 'attended', rates),
    admissionProbability: chainProbabilityFromStage(current, 'admission', rates),
  };
}

function evaluateRules(ctx, rules = PREDICTION_RULES) {
  const positiveFactors = [];
  const negativeFactors = [];
  const appliedRules = [];
  const deltas = {
    bookingProbability: 0,
    attendanceProbability: 0,
    admissionProbability: 0,
  };
  const absolutes = {};

  for (const rule of rules) {
    let matched = false;
    try {
      matched = Boolean(rule.applies(ctx));
    } catch {
      matched = false;
    }
    if (!matched) continue;

    appliedRules.push(rule.id);
    for (const [effectKey, probabilityKey] of [
      ['booking', 'bookingProbability'],
      ['attendance', 'attendanceProbability'],
      ['admission', 'admissionProbability'],
    ]) {
      const ruleEffect = rule.effects?.[effectKey];
      if (!ruleEffect) continue;

      if (ruleEffect.absolute != null) {
        absolutes[probabilityKey] = Math.max(absolutes[probabilityKey] ?? 0, clamp01(ruleEffect.absolute));
      }
      if (ruleEffect.delta != null) {
        deltas[probabilityKey] += ruleEffect.delta;
      }
    }

    const label = Object.values(rule.effects || {})
      .map((e) => e?.label)
      .find(Boolean);
    const factor = {
      ruleId: rule.id,
      category: rule.category,
      label: label || rule.id,
    };
    if (rule.polarity === 'negative') negativeFactors.push(factor);
    else positiveFactors.push(factor);
  }

  return { positiveFactors, negativeFactors, appliedRules, deltas, absolutes };
}

function computeProbabilities(base, ruleEval) {
  const result = { ...base };
  for (const key of ['bookingProbability', 'attendanceProbability', 'admissionProbability']) {
    let value = base[key] + (ruleEval.deltas[key] || 0);
    if (ruleEval.absolutes[key] != null) {
      value = Math.max(value, ruleEval.absolutes[key]);
    }
    result[key] = roundPct(value);
  }

  // Enforce monotonic ordering: admission <= attendance <= booking is NOT right
  // Actually: booking is first, then attendance, then admission - so booking >= attendance >= admission typically
  if (result.attendanceProbability > result.bookingProbability) {
    result.attendanceProbability = result.bookingProbability;
  }
  if (result.admissionProbability > result.attendanceProbability) {
    result.admissionProbability = result.attendanceProbability;
  }

  return result;
}

function computeConfidenceScore(ctx) {
  let score = 0.12;
  const signals = [];

  if (ctx.lifecycleEventCount > 0) {
    score += CONFIDENCE_SIGNALS.lifecycleEvents;
    signals.push('lifecycle_events');
  }
  if (ctx.score) {
    score += CONFIDENCE_SIGNALS.leadScore;
    signals.push('lead_score');
  }
  if (ctx.profile) {
    score += CONFIDENCE_SIGNALS.whatsappProfile;
    signals.push('whatsapp_profile');
  }
  if (ctx.daysSinceInteraction != null && ctx.daysSinceInteraction <= 14) {
    score += CONFIDENCE_SIGNALS.recentInteraction;
    signals.push('recent_interaction');
  }
  if (ctx.copilot?.sessionCount > 0) {
    score += CONFIDENCE_SIGNALS.copilotHandoff;
    signals.push('copilot_handoff');
  }
  if (ctx.copilot?.followupsSent > 0 || ctx.copilot?.followupReplies > 0) {
    score += CONFIDENCE_SIGNALS.followupHistory;
    signals.push('followup_history');
  }
  if ((ctx.score?.confidence ?? 0) >= SCORE_CONFIDENCE_HIGH_THRESHOLD) {
    score += CONFIDENCE_SIGNALS.scoreConfidenceHigh;
    signals.push('score_confidence_high');
  }
  if (ctx.baselines?.funnel?.meta?.cohortSize > 0) {
    score += CONFIDENCE_SIGNALS.portfolioBaselines;
    signals.push('portfolio_baselines');
  }

  const confidenceScore = roundPct(score);
  let confidence = 'low';
  if (confidenceScore >= 70) confidence = 'high';
  else if (confidenceScore >= 45) confidence = 'medium';

  return {
    confidenceScore,
    confidence,
    signals,
  };
}

function computeRiskLevel(admissionProbability, negativeFactors = []) {
  const admission = admissionProbability / 100;
  const negativeWeight = negativeFactors.length;

  if (admission < RISK_THRESHOLDS.critical || (admission < 0.15 && negativeWeight >= 3)) {
    return 'critical';
  }
  if (admission < RISK_THRESHOLDS.high || (admission < 0.25 && negativeWeight >= 2)) {
    return 'high';
  }
  if (admission < RISK_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'low';
}

async function loadPortfolioBaselines({ sinceDays = 30 } = {}) {
  const [funnel, followup, counsellor] = await Promise.all([
    getLifecycleFunnel({}),
    getFollowupEffectiveness({ sinceDays }),
    getCounsellorPerformance({ sinceDays }),
  ]);

  const transitionRates = buildTransitionRatesFromFunnel(funnel);
  const counsellorById = new Map(
    (counsellor?.counsellors || []).map((row) => [row.counsellorId, row])
  );

  return {
    funnel,
    followup,
    counsellor,
    transitionRates,
    counsellorById,
    sinceDays,
    generatedAt: new Date(),
  };
}

function counsellorMetricsForLead(handoffs = [], baselines = {}) {
  const counsellorId = handoffs.find((h) => h.assignedSrCounsellor)?.assignedSrCounsellor;
  if (!counsellorId) return null;
  const row = baselines.counsellorById?.get(counsellorId);
  if (!row) return { counsellorId, sessionsHandled: 0, bookingRate: 0, admissionRate: 0 };

  const sessionsHandled = row.sessionsHandled || 0;
  return {
    counsellorId,
    sessionsHandled,
    bookingRate: sessionsHandled ? (row.bookingsGenerated || 0) / sessionsHandled : 0,
    admissionRate: sessionsHandled ? (row.admissionsGenerated || 0) / sessionsHandled : 0,
    avgResponseTime: row.avgResponseTime || 0,
  };
}

function summarizeCopilotHandoffs(handoffs = []) {
  let followupsSent = 0;
  let followupReplies = 0;
  let hasActiveOrAssigned = false;
  const responseMs = [];

  for (const handoff of handoffs) {
    if (COPILOT_ASSIGNED_STATES.includes(handoff.copilotState)) {
      hasActiveOrAssigned = true;
    }
    if (handoff.firstResponseAt && handoff.createdAt) {
      const ms = new Date(handoff.firstResponseAt).getTime() - new Date(handoff.createdAt).getTime();
      if (ms >= 0) responseMs.push(ms);
    }
    for (const followup of handoff.copilotFollowups || []) {
      if (followup.status === 'sent') {
        followupsSent += 1;
        if (followup.responseReceived) followupReplies += 1;
      }
    }
  }

  const avgResponseMs = responseMs.length
    ? responseMs.reduce((a, b) => a + b, 0) / responseMs.length
    : null;

  return {
    sessionCount: handoffs.length,
    hasActiveOrAssigned,
    followupsSent,
    followupReplies,
    avgResponseMs,
  };
}

async function loadLeadPredictionContext(phone10, baselines = null) {
  const resolvedBaselines = baselines || (await loadPortfolioBaselines());

  const [lifecycleEvents, score, profile, handoffs] = await Promise.all([
    LeadLifecycleEvent.find({ phone10 })
      .select('stage productLine transitionAt meta')
      .sort({ transitionAt: -1 })
      .lean(),
    WhatsAppLeadScore.findOne({ phone: phone10 })
      .select('phone leadScore leadStage scoreReasons confidence lastScoredAt')
      .lean(),
    WhatsAppLeadProfile.findOne({ phone: phone10 })
      .select(
        'phone branchInterest collegeInterest exam demoInterested handoffRequested priceSensitive eventCount lastInteractionAt'
      )
      .lean(),
    WhatsAppAgentHandoff.find({ phone: phone10, route: 'admin_pool' })
      .select('copilotState firstResponseAt createdAt assignedSrCounsellor copilotFollowups')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const lifecycleStages = lifecycleEvents.map((e) => e.stage);
  const lifecycleMaxStage = maxStage(lifecycleStages) || 'lead';
  const hasLifecycleProgress = lifecycleStages.some((s) => rankStage(s) > rankStage('lead'));

  const daysSinceInteraction = daysSince(profile?.lastInteractionAt);
  const copilot = summarizeCopilotHandoffs(handoffs);
  const counsellorMetrics = counsellorMetricsForLead(handoffs, resolvedBaselines);

  return {
    phone: phone10,
    lifecycleEvents,
    lifecycleEventCount: lifecycleEvents.length,
    lifecycleStages,
    lifecycleMaxStage,
    hasLifecycleProgress,
    score,
    profile,
    copilot,
    counsellorMetrics,
    daysSinceInteraction,
    baselines: resolvedBaselines,
  };
}

function buildPredictionPayload(ctx, { fromCache = false, computedAt = new Date() } = {}) {
  const rates = ctx.baselines?.transitionRates || buildDefaultRatesMap();
  const base = computeBaseProbabilities(ctx, rates);
  const ruleEval = evaluateRules(ctx);
  const probabilities = computeProbabilities(base, ruleEval);
  const confidenceMeta = computeConfidenceScore(ctx);
  const riskLevel = computeRiskLevel(probabilities.admissionProbability, ruleEval.negativeFactors);

  return {
    phone: ctx.phone,
    rulesVersion: RULES_VERSION,
    computedAt,
    fromCache,
    lifecycleMaxStage: ctx.lifecycleMaxStage,
    leadStage: ctx.score?.leadStage ?? null,
    leadScore: ctx.score?.leadScore ?? null,
    bookingProbability: probabilities.bookingProbability,
    attendanceProbability: probabilities.attendanceProbability,
    admissionProbability: probabilities.admissionProbability,
    confidenceScore: confidenceMeta.confidenceScore,
    confidence: confidenceMeta.confidence,
    riskLevel,
    explanation: {
      positiveFactors: ruleEval.positiveFactors,
      negativeFactors: ruleEval.negativeFactors,
      confidence: {
        score: confidenceMeta.confidenceScore,
        level: confidenceMeta.confidence,
        signals: confidenceMeta.signals,
      },
      appliedRules: ruleEval.appliedRules,
      baseline: {
        transitionRates: rates,
        lifecycleMaxStage: ctx.lifecycleMaxStage,
        baseProbabilities: {
          booking: roundPct(base.bookingProbability),
          attendance: roundPct(base.attendanceProbability),
          admission: roundPct(base.admissionProbability),
        },
      },
    },
    meta: {
      lifecycleEventCount: ctx.lifecycleEventCount,
      copilotSessions: ctx.copilot?.sessionCount || 0,
      counsellorId: ctx.counsellorMetrics?.counsellorId || null,
      portfolioBaselinesAt: ctx.baselines?.generatedAt || null,
    },
  };
}

function isCacheValid(doc) {
  if (!doc) return false;
  if (doc.rulesVersion !== RULES_VERSION) return false;
  if (!doc.expiresAt || new Date(doc.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

async function readCachedPrediction(phone10) {
  const doc = await LeadConversionPrediction.findOne({ phone: phone10 }).lean();
  if (!isCacheValid(doc)) return null;
  return {
    ...doc.payload,
    fromCache: true,
    computedAt: doc.computedAt,
    cacheExpiresAt: doc.expiresAt,
  };
}

async function writeCachedPrediction(phone10, payload) {
  const computedAt = new Date();
  const expiresAt = new Date(computedAt.getTime() + CACHE_TTL_MS);
  const stored = { ...payload, fromCache: false, computedAt, cacheExpiresAt: expiresAt };

  await LeadConversionPrediction.findOneAndUpdate(
    { phone: phone10 },
    {
      phone: phone10,
      rulesVersion: RULES_VERSION,
      payload: stored,
      computedAt,
      expiresAt,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return stored;
}

async function computePredictionForPhone(phone10, baselines = null) {
  const ctx = await loadLeadPredictionContext(phone10, baselines);
  return buildPredictionPayload(ctx);
}

async function getPredictionForPhone(phone, { force = false } = {}) {
  const phone10 = normalizePhone10(phone);
  if (!phone10) {
    return { error: 'Invalid phone. Expected 10 digits.', status: 400 };
  }

  if (!force) {
    const cached = await module.exports.readCachedPrediction(phone10);
    if (cached) return { prediction: cached, servedFromCache: true };
  }

  const prediction = await module.exports.computePredictionForPhone(phone10);
  const stored = await module.exports.writeCachedPrediction(phone10, prediction);
  return { prediction: stored, servedFromCache: false };
}

function parsePortfolioQuery(query = {}) {
  const stage = query.stage ? String(query.stage).trim().toLowerCase() : null;
  const minScore = query.minScore != null && query.minScore !== '' ? Number(query.minScore) : null;
  const limit = Math.min(
    Math.max(parseInt(query.limit, 10) || PORTFOLIO_DEFAULT_LIMIT, 1),
    PORTFOLIO_MAX_LIMIT
  );
  const sortBy = ['admissionProbability', 'bookingProbability', 'riskLevel', 'leadScore'].includes(
    query.sortBy
  )
    ? query.sortBy
    : 'admissionProbability';

  return { stage, minScore, limit, sortBy };
}

async function getPortfolioPredictions(query = {}) {
  const { stage, minScore, limit, sortBy } = parsePortfolioQuery(query);
  const baselines = await loadPortfolioBaselines({ sinceDays: query.sinceDays || 30 });

  const match = {};
  if (stage) match.leadStage = stage;
  if (minScore != null && Number.isFinite(minScore)) match.leadScore = { $gte: minScore };

  const leads = await WhatsAppLeadScore.find(match)
    .select('phone leadScore leadStage lastScoredAt')
    .sort({ leadScore: -1 })
    .limit(limit)
    .lean();

  const predictions = [];
  for (const lead of leads) {
    const cached = await readCachedPrediction(lead.phone);
    const prediction = cached || (await computePredictionForPhone(lead.phone, baselines));
    if (!cached) {
      await writeCachedPrediction(lead.phone, prediction);
    }
    predictions.push({
      phone: lead.phone,
      leadScore: lead.leadScore,
      leadStage: lead.leadStage,
      bookingProbability: prediction.bookingProbability,
      attendanceProbability: prediction.attendanceProbability,
      admissionProbability: prediction.admissionProbability,
      confidenceScore: prediction.confidenceScore,
      riskLevel: prediction.riskLevel,
      lifecycleMaxStage: prediction.lifecycleMaxStage,
      computedAt: prediction.computedAt,
      fromCache: Boolean(cached),
    });
  }

  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  predictions.sort((a, b) => {
    if (sortBy === 'riskLevel') {
      return (riskOrder[a.riskLevel] ?? 9) - (riskOrder[b.riskLevel] ?? 9);
    }
    if (sortBy === 'leadScore') {
      return (b.leadScore ?? 0) - (a.leadScore ?? 0);
    }
    return (b[sortBy] ?? 0) - (a[sortBy] ?? 0);
  });

  const summary = {
    count: predictions.length,
    avgBookingProbability:
      predictions.length
        ? Math.round(
            (predictions.reduce((s, p) => s + p.bookingProbability, 0) / predictions.length) * 10
          ) / 10
        : 0,
    avgAttendanceProbability:
      predictions.length
        ? Math.round(
            (predictions.reduce((s, p) => s + p.attendanceProbability, 0) / predictions.length) * 10
          ) / 10
        : 0,
    avgAdmissionProbability:
      predictions.length
        ? Math.round(
            (predictions.reduce((s, p) => s + p.admissionProbability, 0) / predictions.length) * 10
          ) / 10
        : 0,
    riskBreakdown: predictions.reduce((acc, p) => {
      acc[p.riskLevel] = (acc[p.riskLevel] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    meta: {
      rulesVersion: RULES_VERSION,
      generatedAt: new Date(),
      limit,
      sortBy,
      filters: { stage, minScore },
      portfolioBaselines: {
        cohortSize: baselines.funnel?.meta?.cohortSize ?? 0,
        followupReplyRate: baselines.followup?.replyRate ?? 0,
        followupConversionRate: baselines.followup?.conversionRate ?? 0,
      },
    },
    summary,
    items: predictions,
  };
}

async function recomputePredictions({ phones = [], all = false, limit = PORTFOLIO_MAX_LIMIT } = {}) {
  const baselines = await loadPortfolioBaselines();
  let targetPhones = [];

  if (all) {
    const rows = await WhatsAppLeadScore.find({})
      .select('phone')
      .sort({ leadScore: -1 })
      .limit(Math.min(limit, PORTFOLIO_MAX_LIMIT))
      .lean();
    targetPhones = rows.map((r) => r.phone);
  } else {
    targetPhones = [...new Set(phones.map((p) => normalizePhone10(p)).filter(Boolean))];
  }

  if (!targetPhones.length) {
    return { error: 'No valid phones to recompute.', status: 400 };
  }

  await LeadConversionPrediction.deleteMany({
    phone: { $in: targetPhones },
    rulesVersion: { $ne: RULES_VERSION },
  });

  const results = [];
  for (const phone10 of targetPhones) {
    const prediction = await computePredictionForPhone(phone10, baselines);
    const stored = await writeCachedPrediction(phone10, prediction);
    results.push({
      phone: phone10,
      admissionProbability: stored.admissionProbability,
      riskLevel: stored.riskLevel,
      computedAt: stored.computedAt,
    });
  }

  return {
    recomputed: results.length,
    rulesVersion: RULES_VERSION,
    items: results,
    generatedAt: new Date(),
  };
}

module.exports = {
  RULES_VERSION,
  CACHE_TTL_MS,
  clamp01,
  roundPct,
  buildTransitionRatesFromFunnel,
  chainProbabilityFromStage,
  computeBaseProbabilities,
  evaluateRules,
  computeProbabilities,
  computeConfidenceScore,
  computeRiskLevel,
  buildPredictionPayload,
  loadPortfolioBaselines,
  loadLeadPredictionContext,
  getPredictionForPhone,
  getPortfolioPredictions,
  recomputePredictions,
  readCachedPrediction,
  writeCachedPrediction,
  isCacheValid,
  computePredictionForPhone,
};
