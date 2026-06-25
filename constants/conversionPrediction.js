'use strict';

const { LIFECYCLE_STAGES } = require('./leadLifecycle');

/** Bump when rule weights or logic change (invalidates cache). */
const RULES_VERSION = 'conversionPrediction.v1';

/** Default cache TTL for stored predictions (1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000;

const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);

const RISK_THRESHOLDS = Object.freeze({
  critical: 0.1,
  high: 0.3,
  medium: 0.55,
});

const PORTFOLIO_DEFAULT_LIMIT = 50;
const PORTFOLIO_MAX_LIMIT = 200;

/** Default conditional transition rates when funnel data is sparse. */
const DEFAULT_TRANSITION_RATES = Object.freeze({
  'lead->qualified': 0.55,
  'qualified->interested': 0.45,
  'interested->booked': 0.35,
  'booked->attended': 0.7,
  'attended->admission': 0.25,
});

const CONFIDENCE_SIGNALS = Object.freeze({
  lifecycleEvents: 0.18,
  leadScore: 0.18,
  whatsappProfile: 0.12,
  recentInteraction: 0.1,
  copilotHandoff: 0.14,
  followupHistory: 0.08,
  scoreConfidenceHigh: 0.1,
  portfolioBaselines: 0.1,
});

const SCORE_CONFIDENCE_HIGH_THRESHOLD = 0.7;
const RECENT_INTERACTION_DAYS = 14;
const STALE_INTERACTION_DAYS = 45;

/**
 * Configurable rule engine entries.
 * Each rule may adjust booking / attendance / admission probabilities and contributes to explainability.
 */
const PREDICTION_RULES = Object.freeze([
  {
    id: 'lifecycle_already_admission',
    category: 'lifecycle',
    polarity: 'positive',
    applies: (ctx) => ctx.lifecycleMaxStage === 'admission',
    effects: {
      booking: { delta: 1, absolute: 1, label: 'Lead already reached admission stage' },
      attendance: { delta: 1, absolute: 1, label: 'Lead already attended counselling' },
      admission: { delta: 1, absolute: 1, label: 'Lead already converted to admission' },
    },
  },
  {
    id: 'lifecycle_attended',
    category: 'lifecycle',
    polarity: 'positive',
    applies: (ctx) => ctx.lifecycleMaxStage === 'attended',
    effects: {
      booking: { delta: 1, absolute: 1, label: 'Demo already booked' },
      attendance: { delta: 1, absolute: 1, label: 'Lead already attended session' },
      admission: { delta: 0.12, label: 'Attended leads convert better to admission' },
    },
  },
  {
    id: 'lifecycle_booked',
    category: 'lifecycle',
    polarity: 'positive',
    applies: (ctx) => ctx.lifecycleMaxStage === 'booked',
    effects: {
      booking: { delta: 1, absolute: 1, label: 'Demo slot already booked' },
      attendance: { delta: 0.15, label: 'Booked leads have higher attendance likelihood' },
      admission: { delta: 0.08, label: 'Booking is a positive conversion signal' },
    },
  },
  {
    id: 'lifecycle_interested',
    category: 'lifecycle',
    polarity: 'positive',
    applies: (ctx) => ctx.lifecycleMaxStage === 'interested',
    effects: {
      booking: { delta: 0.12, label: 'Lead expressed interest in lifecycle funnel' },
      attendance: { delta: 0.08, label: 'Interest stage improves downstream attendance odds' },
      admission: { delta: 0.05, label: 'Interest stage improves admission odds' },
    },
  },
  {
    id: 'lifecycle_stalled_lead',
    category: 'lifecycle',
    polarity: 'negative',
    applies: (ctx) => ctx.lifecycleMaxStage === 'lead' && !ctx.hasLifecycleProgress,
    effects: {
      booking: { delta: -0.1, label: 'No lifecycle progression beyond initial lead stage' },
      attendance: { delta: -0.08, label: 'Stalled at lead stage reduces attendance odds' },
      admission: { delta: -0.06, label: 'Stalled at lead stage reduces admission odds' },
    },
  },
  {
    id: 'score_hot',
    category: 'lead_score',
    polarity: 'positive',
    applies: (ctx) => ctx.score?.leadStage === 'hot',
    effects: {
      booking: { delta: 0.14, label: 'Hot WhatsApp lead score stage' },
      attendance: { delta: 0.1, label: 'Hot score correlates with session attendance' },
      admission: { delta: 0.08, label: 'Hot score correlates with admission conversion' },
    },
  },
  {
    id: 'score_warm',
    category: 'lead_score',
    polarity: 'positive',
    applies: (ctx) => ctx.score?.leadStage === 'warm',
    effects: {
      booking: { delta: 0.08, label: 'Warm WhatsApp lead score stage' },
      attendance: { delta: 0.05, label: 'Warm score supports attendance likelihood' },
      admission: { delta: 0.04, label: 'Warm score supports admission likelihood' },
    },
  },
  {
    id: 'score_cold_high_value',
    category: 'lead_score',
    polarity: 'negative',
    applies: (ctx) => ctx.score?.leadStage === 'cold' && (ctx.score?.leadScore ?? 0) < 30,
    effects: {
      booking: { delta: -0.12, label: 'Cold lead with low numeric score' },
      attendance: { delta: -0.1, label: 'Low score reduces expected attendance' },
      admission: { delta: -0.08, label: 'Low score reduces expected admission' },
    },
  },
  {
    id: 'score_high_numeric',
    category: 'lead_score',
    polarity: 'positive',
    applies: (ctx) => (ctx.score?.leadScore ?? 0) >= 70,
    effects: {
      booking: { delta: 0.1, label: 'Lead score at or above 70' },
      attendance: { delta: 0.07, label: 'High numeric score supports attendance' },
      admission: { delta: 0.06, label: 'High numeric score supports admission' },
    },
  },
  {
    id: 'whatsapp_demo_interest',
    category: 'whatsapp_engagement',
    polarity: 'positive',
    applies: (ctx) => Boolean(ctx.profile?.demoInterested),
    effects: {
      booking: { delta: 0.16, label: 'Demo interest captured in WhatsApp profile' },
      attendance: { delta: 0.12, label: 'Demo interest improves attendance odds' },
      admission: { delta: 0.07, label: 'Demo interest is a conversion signal' },
    },
  },
  {
    id: 'whatsapp_handoff_requested',
    category: 'whatsapp_engagement',
    polarity: 'positive',
    applies: (ctx) => Boolean(ctx.profile?.handoffRequested),
    effects: {
      booking: { delta: 0.1, label: 'Requested human handoff via WhatsApp' },
      attendance: { delta: 0.08, label: 'Handoff request indicates engagement' },
      admission: { delta: 0.05, label: 'Handoff request supports conversion' },
    },
  },
  {
    id: 'whatsapp_high_events',
    category: 'whatsapp_engagement',
    polarity: 'positive',
    applies: (ctx) => (ctx.profile?.eventCount ?? 0) >= 8,
    effects: {
      booking: { delta: 0.08, label: 'High WhatsApp event count (8+)' },
      attendance: { delta: 0.06, label: 'Sustained WhatsApp engagement' },
      admission: { delta: 0.04, label: 'Sustained engagement supports conversion' },
    },
  },
  {
    id: 'whatsapp_low_engagement',
    category: 'whatsapp_engagement',
    polarity: 'negative',
    applies: (ctx) => (ctx.profile?.eventCount ?? 0) <= 1 && !ctx.profile?.lastInteractionAt,
    effects: {
      booking: { delta: -0.1, label: 'Minimal WhatsApp engagement recorded' },
      attendance: { delta: -0.08, label: 'Low engagement reduces attendance odds' },
      admission: { delta: -0.06, label: 'Low engagement reduces admission odds' },
    },
  },
  {
    id: 'whatsapp_stale_interaction',
    category: 'whatsapp_engagement',
    polarity: 'negative',
    applies: (ctx) => ctx.daysSinceInteraction != null && ctx.daysSinceInteraction > STALE_INTERACTION_DAYS,
    effects: {
      booking: { delta: -0.12, label: 'No recent WhatsApp interaction (45+ days)' },
      attendance: { delta: -0.1, label: 'Stale engagement reduces attendance odds' },
      admission: { delta: -0.08, label: 'Stale engagement reduces admission odds' },
    },
  },
  {
    id: 'whatsapp_recent_interaction',
    category: 'whatsapp_engagement',
    polarity: 'positive',
    applies: (ctx) =>
      ctx.daysSinceInteraction != null && ctx.daysSinceInteraction <= RECENT_INTERACTION_DAYS,
    effects: {
      booking: { delta: 0.08, label: 'Recent WhatsApp interaction within 14 days' },
      attendance: { delta: 0.06, label: 'Recent activity supports attendance' },
      admission: { delta: 0.04, label: 'Recent activity supports conversion' },
    },
  },
  {
    id: 'copilot_active_session',
    category: 'human_copilot',
    polarity: 'positive',
    applies: (ctx) => ctx.copilot?.hasActiveOrAssigned,
    effects: {
      booking: { delta: 0.12, label: 'Active or assigned human copilot session' },
      attendance: { delta: 0.1, label: 'Copilot engagement improves attendance odds' },
      admission: { delta: 0.07, label: 'Copilot engagement improves conversion odds' },
    },
  },
  {
    id: 'copilot_fast_response',
    category: 'human_copilot',
    polarity: 'positive',
    applies: (ctx) =>
      ctx.copilot?.avgResponseMs != null && ctx.copilot.avgResponseMs > 0 && ctx.copilot.avgResponseMs < 30 * 60 * 1000,
    effects: {
      booking: { delta: 0.06, label: 'Copilot first response under 30 minutes' },
      attendance: { delta: 0.05, label: 'Fast counsellor response supports attendance' },
      admission: { delta: 0.04, label: 'Fast counsellor response supports conversion' },
    },
  },
  {
    id: 'copilot_slow_response',
    category: 'human_copilot',
    polarity: 'negative',
    applies: (ctx) => ctx.copilot?.avgResponseMs != null && ctx.copilot.avgResponseMs > 4 * 60 * 60 * 1000,
    effects: {
      booking: { delta: -0.08, label: 'Slow copilot first response (4+ hours)' },
      attendance: { delta: -0.06, label: 'Slow response reduces attendance odds' },
      admission: { delta: -0.05, label: 'Slow response reduces conversion odds' },
    },
  },
  {
    id: 'copilot_no_handoff',
    category: 'human_copilot',
    polarity: 'negative',
    applies: (ctx) => Boolean(ctx.profile?.handoffRequested) && !ctx.copilot?.sessionCount,
    effects: {
      booking: { delta: -0.1, label: 'Handoff requested but no copilot session recorded' },
      attendance: { delta: -0.08, label: 'Missing copilot follow-through after handoff request' },
      admission: { delta: -0.06, label: 'Missing copilot follow-through reduces conversion odds' },
    },
  },
  {
    id: 'followup_replied',
    category: 'followup_effectiveness',
    polarity: 'positive',
    applies: (ctx) => ctx.copilot?.followupReplies > 0,
    effects: {
      booking: { delta: 0.1, label: 'Lead replied to copilot follow-up' },
      attendance: { delta: 0.08, label: 'Follow-up reply improves attendance odds' },
      admission: { delta: 0.06, label: 'Follow-up reply improves conversion odds' },
    },
  },
  {
    id: 'followup_sent_no_reply',
    category: 'followup_effectiveness',
    polarity: 'negative',
    applies: (ctx) => ctx.copilot?.followupsSent > 0 && ctx.copilot?.followupReplies === 0,
    effects: {
      booking: { delta: -0.08, label: 'Copilot follow-ups sent without reply' },
      attendance: { delta: -0.06, label: 'Unanswered follow-ups reduce attendance odds' },
      admission: { delta: -0.05, label: 'Unanswered follow-ups reduce conversion odds' },
    },
  },
  {
    id: 'followup_portfolio_strong',
    category: 'followup_effectiveness',
    polarity: 'positive',
    applies: (ctx) => (ctx.baselines?.followup?.replyRate ?? 0) >= 25,
    effects: {
      booking: { delta: 0.04, label: 'Portfolio follow-up reply rate is healthy (25%+)' },
      attendance: { delta: 0.03, label: 'Strong portfolio follow-up effectiveness' },
      admission: { delta: 0.02, label: 'Strong portfolio follow-up effectiveness' },
    },
  },
  {
    id: 'counsellor_high_bookings',
    category: 'counsellor_performance',
    polarity: 'positive',
    applies: (ctx) => (ctx.counsellorMetrics?.bookingRate ?? 0) >= 0.2,
    effects: {
      booking: { delta: 0.08, label: 'Assigned counsellor has strong booking track record' },
      attendance: { delta: 0.06, label: 'Strong counsellor booking performance' },
      admission: { delta: 0.05, label: 'Strong counsellor supports conversion' },
    },
  },
  {
    id: 'counsellor_low_bookings',
    category: 'counsellor_performance',
    polarity: 'negative',
    applies: (ctx) =>
      ctx.counsellorMetrics?.sessionsHandled >= 5 && (ctx.counsellorMetrics?.bookingRate ?? 0) < 0.08,
    effects: {
      booking: { delta: -0.06, label: 'Assigned counsellor booking rate below portfolio norm' },
      attendance: { delta: -0.04, label: 'Weak counsellor booking performance' },
      admission: { delta: -0.03, label: 'Weak counsellor performance reduces conversion odds' },
    },
  },
  {
    id: 'price_sensitive',
    category: 'whatsapp_engagement',
    polarity: 'negative',
    applies: (ctx) => Boolean(ctx.profile?.priceSensitive),
    effects: {
      booking: { delta: -0.05, label: 'Price sensitivity flagged in profile' },
      attendance: { delta: -0.04, label: 'Price sensitivity may reduce attendance' },
      admission: { delta: -0.06, label: 'Price sensitivity reduces admission likelihood' },
    },
  },
]);

function transitionKey(from, to) {
  return `${from}->${to}`;
}

function buildDefaultRatesMap() {
  return { ...DEFAULT_TRANSITION_RATES };
}

module.exports = {
  RULES_VERSION,
  CACHE_TTL_MS,
  RISK_LEVELS,
  RISK_THRESHOLDS,
  PORTFOLIO_DEFAULT_LIMIT,
  PORTFOLIO_MAX_LIMIT,
  DEFAULT_TRANSITION_RATES,
  CONFIDENCE_SIGNALS,
  SCORE_CONFIDENCE_HIGH_THRESHOLD,
  RECENT_INTERACTION_DAYS,
  STALE_INTERACTION_DAYS,
  PREDICTION_RULES,
  LIFECYCLE_STAGES,
  transitionKey,
  buildDefaultRatesMap,
};
