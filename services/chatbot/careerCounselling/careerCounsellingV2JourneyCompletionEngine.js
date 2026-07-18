'use strict';

const {
  STAGES,
  PHASE14_STEPS,
  PHASE14_ENGINE_VERSION,
  JOURNEY_VERSION,
  getPhase14Message,
  isPhase14Stage,
  isPhase14Step,
} = require('../../../constants/careerCounsellingV2JourneyCompletion');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isPhase14Ack } = require('./careerCounsellingV2JourneyCompletionParser');
const {
  resolveJourneyOutcome,
  resolveBookingStatusFinal,
  computeJourneyDurationMs,
  computeJourneyInteractions,
  buildPlatformHandoffPayload,
  buildClosureReply,
} = require('./careerCounsellingV2JourneyCompletionCore');
const {
  logJourneyCompleted,
  logJourneyOutcome,
  logJourneyDuration,
  logJourneyInteractions,
  logPlatformHandoffCreated,
  logBookingStatusFinal,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function withTracking(profile = {}, patch = {}) {
  return { ...profile, ...patch };
}

/**
 * Runs booking_complete → journey_summary → platform_handoff → journey_completed
 * atomically in one turn (deterministic closure; no counseling).
 */
function startJourneyCompletion(ctx, analyticsMeta = {}, opts = {}) {
  const profile = { ...(ctx.profile || {}) };
  const journeyOutcome = resolveJourneyOutcome(profile, opts);
  const bookingStatus = resolveBookingStatusFinal(profile, journeyOutcome);
  const durationMs = computeJourneyDurationMs(ctx, profile);
  const interactions = computeJourneyInteractions(ctx, profile);
  const handoff = buildPlatformHandoffPayload(ctx, profile, journeyOutcome);
  const reply = buildClosureReply(journeyOutcome);

  logJourneyOutcome({
    stage: STAGES.PHASE_14_JOURNEY_COMPLETION,
    journeyOutcome,
    ...analyticsMeta,
  });
  logBookingStatusFinal({
    stage: STAGES.PHASE_14_JOURNEY_COMPLETION,
    bookingStatus,
    journeyOutcome,
    ...analyticsMeta,
  });
  if (durationMs != null) {
    logJourneyDuration({
      stage: STAGES.PHASE_14_JOURNEY_COMPLETION,
      journeyDurationMs: durationMs,
      ...analyticsMeta,
    });
  }
  if (interactions != null) {
    logJourneyInteractions({
      stage: STAGES.PHASE_14_JOURNEY_COMPLETION,
      journeyInteractions: interactions,
      ...analyticsMeta,
    });
  }
  logPlatformHandoffCreated({
    stage: STAGES.PHASE_14_JOURNEY_COMPLETION,
    journeyOutcome,
    journeyVersion: JOURNEY_VERSION,
    serviceSelected: handoff.serviceSelected,
    ...analyticsMeta,
  });
  logJourneyCompleted({
    stage: STAGES.JOURNEY_COMPLETED,
    journeyOutcome,
    journeyVersion: JOURNEY_VERSION,
    ...analyticsMeta,
  });
  logProfileUpdated({
    stage: STAGES.JOURNEY_COMPLETED,
    fieldsUpdated: [
      'journeyCompleted',
      'journeyOutcome',
      'platformHandoffPayload',
      'phase14EngineVersion',
    ],
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.JOURNEY_COMPLETED,
      step: 'journey_completed',
      lastQuestionKey: 'journey_completed',
      profile: withTracking(profile, {
        journeyCompleted: true,
        journeyOutcome,
        journeyVersion: JOURNEY_VERSION,
        bookingStatusFinal: bookingStatus,
        platformHandoffPayload: handoff,
        phase14EngineVersion: PHASE14_ENGINE_VERSION,
        phase14Completed: true,
        phase14CompletedAt: handoff.completedAt,
      }),
    },
    clearState: false,
    analytics: [
      { type: 'journey_outcome', journeyOutcome },
      { type: 'booking_status_final', bookingStatus },
      { type: 'platform_handoff_created' },
      { type: 'journey_completed', journeyOutcome },
    ],
  };
}

async function processJourneyCompletionTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startJourneyCompletion ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    (isPhase14Stage(ctx.stage) &&
      !PHASE14_STEPS.includes(ctx.step) &&
      ctx.step !== 'journey_completed')
  ) {
    return startJourneyCompletion(ctx, analyticsMeta, opts);
  }

  if (
    ctx.profile?.journeyCompleted === true ||
    ctx.stage === STAGES.JOURNEY_COMPLETED ||
    ctx.step === 'journey_completed'
  ) {
    if (isCareerCounsellingJourneyBreakout(inbound)) {
      return {
        reply: BREAKOUT_DEFLECTION,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    return {
      reply: getPhase14Message('sticky'),
      context: {
        ...ctx,
        stage: STAGES.JOURNEY_COMPLETED,
        step: 'journey_completed',
      },
      clearState: false,
      analytics: [],
    };
  }

  if (isPhase14Ack(inbound) || inbound.length === 0) {
    return startJourneyCompletion(ctx, analyticsMeta, opts);
  }

  return startJourneyCompletion(ctx, analyticsMeta, opts);
}

module.exports = {
  STAGES,
  PHASE14_STEPS,
  PHASE14_ENGINE_VERSION,
  JOURNEY_VERSION,
  startJourneyCompletion,
  processJourneyCompletionTurn,
  isPhase14Stage,
  isPhase14Step,
  resolveJourneyOutcome,
};
