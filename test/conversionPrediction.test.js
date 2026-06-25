'use strict';

const { describe, test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const PredictionModel = require('../models/LeadConversionPrediction');
const predictionSvc = require('../services/analytics/predictionService');
const { PREDICTION_RULES, RULES_VERSION, CACHE_TTL_MS } = require('../constants/conversionPrediction');

const SAMPLE_FUNNEL = {
  stageCounts: {
    lead: 1000,
    qualified: 600,
    interested: 300,
    booked: 120,
    attended: 84,
    admission: 25,
  },
  stages: [],
  meta: { cohortSize: 1000 },
};

function buildSampleContext(overrides = {}) {
  return {
    phone: '9876543210',
    lifecycleEvents: [{ stage: 'interested' }],
    lifecycleEventCount: 1,
    lifecycleStages: ['lead', 'interested'],
    lifecycleMaxStage: 'interested',
    hasLifecycleProgress: true,
    score: { leadScore: 72, leadStage: 'hot', confidence: 0.82 },
    profile: {
      demoInterested: true,
      eventCount: 10,
      lastInteractionAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      handoffRequested: false,
      priceSensitive: false,
    },
    copilot: {
      sessionCount: 1,
      hasActiveOrAssigned: true,
      followupsSent: 2,
      followupReplies: 1,
      avgResponseMs: 15 * 60 * 1000,
    },
    counsellorMetrics: {
      counsellorId: 'sr1',
      sessionsHandled: 20,
      bookingRate: 0.25,
      admissionRate: 0.1,
    },
    daysSinceInteraction: 3,
    baselines: {
      funnel: SAMPLE_FUNNEL,
      followup: { replyRate: 28, conversionRate: 9 },
      transitionRates: predictionSvc.buildTransitionRatesFromFunnel(SAMPLE_FUNNEL),
      generatedAt: new Date(),
    },
    ...overrides,
  };
}

describe('conversionPrediction rule engine', () => {
  test('evaluateRules applies hot score and demo interest rules', () => {
    const ctx = buildSampleContext();
    const result = predictionSvc.evaluateRules(ctx);
    assert.ok(result.appliedRules.includes('score_hot'));
    assert.ok(result.appliedRules.includes('whatsapp_demo_interest'));
    assert.ok(result.positiveFactors.length > 0);
    assert.ok(result.deltas.bookingProbability > 0);
  });

  test('evaluateRules flags stale engagement as negative', () => {
    const ctx = buildSampleContext({
      profile: {
        eventCount: 2,
        lastInteractionAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        demoInterested: false,
      },
      daysSinceInteraction: 60,
      score: { leadScore: 20, leadStage: 'cold', confidence: 0.4 },
      lifecycleMaxStage: 'lead',
      hasLifecycleProgress: false,
      copilot: { sessionCount: 0, followupsSent: 0, followupReplies: 0 },
    });
    const result = predictionSvc.evaluateRules(ctx);
    assert.ok(result.appliedRules.includes('whatsapp_stale_interaction'));
    assert.ok(result.negativeFactors.length > 0);
    assert.ok(result.deltas.bookingProbability < 0);
  });

  test('lifecycle admission sets absolute probabilities to 100%', () => {
    const ctx = buildSampleContext({ lifecycleMaxStage: 'admission' });
    const base = predictionSvc.computeBaseProbabilities(ctx, predictionSvc.buildTransitionRatesFromFunnel(SAMPLE_FUNNEL));
    const rules = predictionSvc.evaluateRules(ctx);
    const probs = predictionSvc.computeProbabilities(base, rules);
    assert.equal(probs.bookingProbability, 100);
    assert.equal(probs.attendanceProbability, 100);
    assert.equal(probs.admissionProbability, 100);
  });
});

describe('conversionPrediction probability calculation', () => {
  test('buildTransitionRatesFromFunnel derives conditional rates', () => {
    const rates = predictionSvc.buildTransitionRatesFromFunnel(SAMPLE_FUNNEL);
    assert.equal(rates['interested->booked'], 0.4);
    assert.equal(rates['booked->attended'], 0.7);
  });

  test('chainProbabilityFromStage chains multi-hop transitions', () => {
    const rates = predictionSvc.buildTransitionRatesFromFunnel(SAMPLE_FUNNEL);
    const booking = predictionSvc.chainProbabilityFromStage('interested', 'booked', rates);
    const admission = predictionSvc.chainProbabilityFromStage('interested', 'admission', rates);
    assert.equal(booking, 0.4);
    assert.ok(admission > 0 && admission < booking);
  });

  test('computeProbabilities clamps and preserves ordering', () => {
    const base = {
      bookingProbability: 0.5,
      attendanceProbability: 0.4,
      admissionProbability: 0.2,
    };
    const rules = {
      deltas: { bookingProbability: 0.6, attendanceProbability: 0.5, admissionProbability: 0.9 },
      absolutes: {},
    };
    const probs = predictionSvc.computeProbabilities(base, rules);
    assert.equal(probs.bookingProbability, 100);
    assert.equal(probs.attendanceProbability, 90);
    assert.equal(probs.admissionProbability, 90);
  });
});

describe('conversionPrediction confidence calculation', () => {
  test('computeConfidenceScore increases with available signals', () => {
    const sparse = predictionSvc.computeConfidenceScore(
      buildSampleContext({
        lifecycleEventCount: 0,
        score: null,
        profile: null,
        copilot: { sessionCount: 0 },
        baselines: { funnel: { meta: { cohortSize: 0 } } },
      })
    );
    const rich = predictionSvc.computeConfidenceScore(buildSampleContext());
    assert.ok(rich.confidenceScore > sparse.confidenceScore);
    assert.equal(rich.confidence, 'high');
    assert.ok(rich.signals.includes('lead_score'));
  });

  test('computeRiskLevel maps admission probability to risk bands', () => {
    assert.equal(predictionSvc.computeRiskLevel(8, [{}, {}, {}]), 'critical');
    assert.equal(predictionSvc.computeRiskLevel(25, []), 'high');
    assert.equal(predictionSvc.computeRiskLevel(45, []), 'medium');
    assert.equal(predictionSvc.computeRiskLevel(70, []), 'low');
  });
});

describe('conversionPrediction caching', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('isCacheValid rejects stale version and expiry', () => {
    assert.equal(predictionSvc.isCacheValid(null), false);
    assert.equal(
      predictionSvc.isCacheValid({
        rulesVersion: RULES_VERSION,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      }),
      true
    );
    assert.equal(
      predictionSvc.isCacheValid({
        rulesVersion: 'old',
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      }),
      false
    );
    assert.equal(
      predictionSvc.isCacheValid({
        rulesVersion: RULES_VERSION,
        expiresAt: new Date(Date.now() - 1000),
      }),
      false
    );
  });

  test('getPredictionForPhone serves cache without recompute', async () => {
    const cachedPayload = {
      phone: '9876543210',
      rulesVersion: RULES_VERSION,
      admissionProbability: 42,
      bookingProbability: 55,
      attendanceProbability: 48,
      confidenceScore: 60,
      riskLevel: 'medium',
      explanation: { positiveFactors: [], negativeFactors: [], confidence: { score: 60 } },
    };

    mock.method(predictionSvc, 'readCachedPrediction', async () => ({
      ...cachedPayload,
      fromCache: true,
      computedAt: new Date(),
    }));

    const computeMock = mock.method(predictionSvc, 'computePredictionForPhone', async () => {
      throw new Error('should not compute');
    });

    const result = await predictionSvc.getPredictionForPhone('9876543210');
    assert.equal(result.servedFromCache, true);
    assert.equal(result.prediction.admissionProbability, 42);
    assert.equal(computeMock.mock.callCount(), 0);
  });

  test('writeCachedPrediction upserts document', async () => {
    const payload = {
      phone: '9123456789',
      admissionProbability: 30,
      bookingProbability: 40,
      attendanceProbability: 35,
      confidenceScore: 50,
      riskLevel: 'high',
      explanation: { positiveFactors: [], negativeFactors: [], confidence: { score: 50 } },
    };

    mock.method(PredictionModel, 'findOneAndUpdate', () => ({
      lean: async () => ({
        phone: '9123456789',
        rulesVersion: RULES_VERSION,
        payload,
        computedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      }),
    }));

    const stored = await predictionSvc.writeCachedPrediction('9123456789', payload);
    assert.equal(stored.phone, '9123456789');
    assert.ok(stored.cacheExpiresAt);
  });
});

describe('conversionPrediction API payload shape', () => {
  test('buildPredictionPayload includes explainability fields', () => {
    const payload = predictionSvc.buildPredictionPayload(buildSampleContext());
    assert.equal(payload.phone, '9876543210');
    assert.equal(payload.rulesVersion, RULES_VERSION);
    assert.ok(payload.bookingProbability >= 0 && payload.bookingProbability <= 100);
    assert.ok(payload.attendanceProbability >= 0 && payload.attendanceProbability <= 100);
    assert.ok(payload.admissionProbability >= 0 && payload.admissionProbability <= 100);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(payload.riskLevel));
    assert.ok(Array.isArray(payload.explanation.positiveFactors));
    assert.ok(Array.isArray(payload.explanation.negativeFactors));
    assert.ok(payload.explanation.confidence.score >= 0);
    assert.ok(payload.explanation.baseline.baseProbabilities);
  });
});

describe('conversionPrediction configurable rules', () => {
  test('PREDICTION_RULES entries have ids and categories', () => {
    assert.ok(PREDICTION_RULES.length >= 10);
    for (const rule of PREDICTION_RULES) {
      assert.ok(rule.id);
      assert.ok(rule.category);
      assert.ok(typeof rule.applies === 'function');
    }
  });
});
