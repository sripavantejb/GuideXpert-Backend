'use strict';

const {
  JOURNEY_OUTCOMES,
  JOURNEY_VERSION,
  PHASE14_ENGINE_VERSION,
  getPhase14Message,
} = require('../../../constants/careerCounsellingV2JourneyCompletion');

/**
 * Deterministic journey outcome from prior phase flags (read-only).
 */
function resolveJourneyOutcome(profile = {}, opts = {}) {
  if (opts.forcedOutcome && JOURNEY_OUTCOMES[String(opts.forcedOutcome).toUpperCase()]) {
    return opts.forcedOutcome;
  }
  if (opts.forcedOutcome && Object.values(JOURNEY_OUTCOMES).includes(opts.forcedOutcome)) {
    return opts.forcedOutcome;
  }

  const phase13 = profile.phase13Outcome;
  const phase12 = profile.phase12Outcome;

  if (phase12 === 'declined') return JOURNEY_OUTCOMES.OPTED_OUT;

  // Explicit pause after CTA/URL still counts as deferred (not initiated).
  if (phase13 === 'deferred') return JOURNEY_OUTCOMES.BOOKING_DEFERRED;

  if (
    profile.phase13UrlShared === true ||
    phase13 === 'url_shared' ||
    phase13 === 'confirmed_intent'
  ) {
    return JOURNEY_OUTCOMES.BOOKING_INITIATED;
  }

  if (
    profile.phase12Service === 'none' ||
    phase12 === 'continued_none' ||
    phase12 === 'none_selected' ||
    profile.phase13SkipReason === 'service_none' ||
    profile.phase13SkipReason === 'no_service'
  ) {
    return JOURNEY_OUTCOMES.INFORMATION_ONLY;
  }

  if (phase13 === 'abandoned' || phase13 === 'skipped') {
    if (
      profile.phase13SkipReason === 'phase11_escalated' ||
      profile.phase13SkipReason === 'niat_one_on_one_shown' ||
      profile.phase13SkipReason === 'phase11_ooo_exit'
    ) {
      return JOURNEY_OUTCOMES.JOURNEY_COMPLETED;
    }
    return JOURNEY_OUTCOMES.INFORMATION_ONLY;
  }

  return JOURNEY_OUTCOMES.JOURNEY_COMPLETED;
}

function resolveBookingStatusFinal(profile = {}, journeyOutcome) {
  if (journeyOutcome === JOURNEY_OUTCOMES.BOOKING_INITIATED) return 'url_shared';
  if (journeyOutcome === JOURNEY_OUTCOMES.BOOKING_DEFERRED) return 'deferred';
  if (profile.phase13UrlShared) return 'url_shared';
  if (profile.phase13Outcome === 'deferred') return 'deferred';
  if (profile.phase13Skipped) return 'skipped';
  if (profile.phase12Service === 'none') return 'not_applicable';
  return 'not_started';
}

function buildRecommendationSummary(profile = {}) {
  const list = Array.isArray(profile.phase9Recommendations)
    ? profile.phase9Recommendations
    : [];
  return list.slice(0, 3).map((r) => ({
    collegeName: r.collegeName || null,
    rankLabel: r.rankLabel || null,
    confidenceLabel: r.confidenceLabel || null,
  }));
}

function buildConversationSummary(profile = {}, journeyOutcome) {
  const bits = [];
  if (profile.preferredCourse) bits.push(`Course: ${profile.preferredCourse}`);
  if (profile.careerGoal) bits.push(`Goal: ${profile.careerGoal}`);
  if (profile.phase12Service) bits.push(`Service: ${profile.phase12Service}`);
  bits.push(`Outcome: ${journeyOutcome}`);
  return bits.join(' · ');
}

function computeJourneyDurationMs(ctx = {}, profile = {}) {
  const start =
    ctx.discoveryStartedAt ||
    profile.phase13StartedAt ||
    profile.phase12StartedAt ||
    ctx.phase14StartedAt ||
    null;
  if (!start) return null;
  const t0 = Date.parse(start);
  if (Number.isNaN(t0)) return null;
  return Math.max(0, Date.now() - t0);
}

function computeJourneyInteractions(ctx = {}, profile = {}) {
  if (typeof ctx.interactionCount === 'number') return ctx.interactionCount;
  if (typeof profile.journeyInteractionCount === 'number') {
    return profile.journeyInteractionCount;
  }
  return null;
}

/**
 * Read-only snapshot for Platform Services. Does not invoke CRM/booking/reminders.
 */
function buildPlatformHandoffPayload(ctx = {}, profile = {}, journeyOutcome) {
  const bookingStatus = resolveBookingStatusFinal(profile, journeyOutcome);
  const completedAt = new Date().toISOString();

  return Object.freeze({
    studentProfile: Object.freeze({
      preferredCourse: profile.preferredCourse || null,
      careerGoal: profile.careerGoal || profile.careerPriority || null,
      qualification: profile.qualification || null,
      preferredLanguage: profile.preferredLanguage || null,
      locationPreference: profile.locationPreference || profile.preferredCity || null,
      budgetPreference: profile.budgetPreference || profile.budget || null,
      parentPreferences: profile.parentPreferences || null,
    }),
    examDetails: Object.freeze({
      examName: profile.examName || profile.entranceExam || null,
      rank: profile.rank || profile.examRank || null,
      category: profile.category || profile.reservationCategory || null,
    }),
    recommendationSummary: buildRecommendationSummary(profile),
    careerInterests: Object.freeze({
      careerGoal: profile.careerGoal || null,
      studentPriorities: Array.isArray(profile.studentPriorities)
        ? profile.studentPriorities.slice(0, 8)
        : [],
    }),
    collegeInterests: Object.freeze({
      preferredCollege: profile.preferredCollege || null,
      recommendedCount: Array.isArray(profile.recommendedColleges)
        ? profile.recommendedColleges.length
        : 0,
    }),
    resolvedObjections: Object.freeze({
      resolvedConcerns: Array.isArray(profile.resolvedConcerns)
        ? profile.resolvedConcerns.slice(0, 12)
        : [],
      phase11ResolvedHesitations: Array.isArray(profile.phase11ResolvedHesitations)
        ? profile.phase11ResolvedHesitations.slice(0, 12)
        : [],
    }),
    serviceSelected: profile.phase13Service || profile.phase12Service || null,
    bookingStatus,
    conversationSummary: buildConversationSummary(profile, journeyOutcome),
    journeySummary: buildConversationSummary(profile, journeyOutcome),
    journeyOutcome,
    journeyVersion: JOURNEY_VERSION,
    phase14EngineVersion: PHASE14_ENGINE_VERSION,
    completedAt,
  });
}

function buildClosureReply(journeyOutcome) {
  switch (journeyOutcome) {
    case JOURNEY_OUTCOMES.BOOKING_INITIATED:
      return getPhase14Message('booking_initiated');
    case JOURNEY_OUTCOMES.BOOKING_DEFERRED:
      return getPhase14Message('booking_deferred');
    case JOURNEY_OUTCOMES.INFORMATION_ONLY:
      return getPhase14Message('information_only');
    case JOURNEY_OUTCOMES.OPTED_OUT:
      return getPhase14Message('opted_out');
    case JOURNEY_OUTCOMES.JOURNEY_COMPLETED:
    default:
      return getPhase14Message('journey_completed');
  }
}

module.exports = {
  resolveJourneyOutcome,
  resolveBookingStatusFinal,
  buildRecommendationSummary,
  buildConversationSummary,
  computeJourneyDurationMs,
  computeJourneyInteractions,
  buildPlatformHandoffPayload,
  buildClosureReply,
  JOURNEY_OUTCOMES,
  JOURNEY_VERSION,
};
