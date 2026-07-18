'use strict';

const {
  STAGES,
  PHASE13_STEPS,
  PHASE13_ENGINE_VERSION,
  getPhase13Message,
  isPhase13Stage,
  isPhase13Step,
} = require('../../../constants/careerCounsellingV2BookingOrchestrator');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  isPhase13BookNow,
  isPhase13Defer,
  isPhase13Question,
} = require('./careerCounsellingV2BookingOrchestratorParser');
const {
  shouldSkipPhase13,
  resolveBookingDestination,
  buildIntroReply,
  buildUrlShareReply,
} = require('./careerCounsellingV2BookingOrchestratorCore');
const {
  logPhase13Started,
  logBookingServiceSelected,
  logBookingCtaPresented,
  logBookingContinue,
  logBookingUrlShared,
  logBookingResume,
  logBookingDeferred,
  logBookingAbandoned,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function withTracking(profile = {}, patch = {}) {
  return { ...profile, ...patch };
}

function exitToPhase14(ctx, analyticsMeta = {}, opts = {}) {
  const {
    startJourneyCompletion,
  } = require('./careerCounsellingV2JourneyCompletionEngine');
  return startJourneyCompletion(ctx, analyticsMeta, opts);
}

function presentSkipComplete(ctx, skip, analyticsMeta = {}) {
  if (skip.reason === 'unmapped_service') {
    logBookingAbandoned({
      stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
      reason: skip.reason,
      ...analyticsMeta,
    });
  }

  const nextCtx = {
    ...ctx,
    profile: withTracking(ctx.profile || {}, {
      phase13Skipped: true,
      phase13SkipReason: skip.reason,
      phase13Outcome: skip.reason === 'unmapped_service' ? 'abandoned' : 'skipped',
      phase13EngineVersion: PHASE13_ENGINE_VERSION,
      phase13Completed: true,
    }),
  };

  // Skip paths still close via Phase 14 (handoff + terminal state)
  return exitToPhase14(nextCtx, analyticsMeta);
}

function presentAbandoned(ctx, reason, analyticsMeta = {}) {
  logBookingAbandoned({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    reason,
    ...analyticsMeta,
  });
  return exitToPhase14(
    {
      ...ctx,
      profile: withTracking(ctx.profile || {}, {
        phase13Outcome: 'abandoned',
        phase13SkipReason: reason,
        phase13EngineVersion: PHASE13_ENGINE_VERSION,
        phase13Completed: true,
      }),
    },
    analyticsMeta
  );
}

function shareOfficialUrl(ctx, dest, analyticsMeta = {}, extraProfile = {}) {
  const reply = buildUrlShareReply(dest.entry, dest.url);
  logBookingContinue({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    service: dest.service,
    ...analyticsMeta,
  });
  logBookingUrlShared({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    service: dest.service,
    url: dest.url,
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
      step: 'booking_presented',
      lastQuestionKey: 'booking_presented',
      profile: withTracking(ctx.profile || {}, {
        phase13Service: dest.service,
        phase13DestinationKey: dest.entry.serviceKey,
        phase13BookingUrl: dest.url,
        phase13FormMode: dest.entry.formMode,
        phase13UrlShared: true,
        phase13UrlSharedAt: new Date().toISOString(),
        phase13Outcome: 'url_shared',
        phase13EngineVersion: PHASE13_ENGINE_VERSION,
        ...extraProfile,
      }),
    },
    clearState: false,
    analytics: [
      { type: 'booking_continue', service: dest.service },
      { type: 'booking_url_shared', service: dest.service },
    ],
  };
}

function startBookingOrchestrator(ctx, analyticsMeta = {}, opts = {}) {
  const profile = { ...(ctx.profile || {}) };
  const entryMode = opts.entry || 'phase12_continue';
  const shareImmediately = Boolean(opts.shareUrlImmediately);

  const skip = shouldSkipPhase13(profile);
  if (skip.skip) {
    return presentSkipComplete(ctx, skip, analyticsMeta);
  }

  const dest = resolveBookingDestination(profile);
  if (!dest.ok) {
    if (dest.abandoned) return presentAbandoned(ctx, dest.reason, analyticsMeta);
    return presentSkipComplete(ctx, { reason: dest.reason }, analyticsMeta);
  }

  logPhase13Started({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    service: dest.service,
    destinationKey: dest.entry.serviceKey,
    entry: entryMode,
    ...analyticsMeta,
  });
  logBookingServiceSelected({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    service: dest.service,
    destinationKey: dest.entry.serviceKey,
    formMode: dest.entry.formMode,
    ...analyticsMeta,
  });

  const baseProfile = {
    phase13Service: dest.service,
    phase13DestinationKey: dest.entry.serviceKey,
    phase13BookingUrl: dest.url,
    phase13FormMode: dest.entry.formMode,
    phase13CtaPresented: true,
    phase13EngineVersion: PHASE13_ENGINE_VERSION,
    phase13Entry: entryMode,
    phase13StartedAt: new Date().toISOString(),
  };

  if (shareImmediately) {
    logBookingCtaPresented({
      stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
      service: dest.service,
      ...analyticsMeta,
    });
    return shareOfficialUrl(ctx, dest, analyticsMeta, baseProfile);
  }

  const reply = buildIntroReply(dest.entry);
  logBookingCtaPresented({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    service: dest.service,
    ...analyticsMeta,
  });
  logProfileUpdated({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    fieldsUpdated: ['phase13Service', 'phase13BookingUrl', 'phase13CtaPresented'],
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
      step: 'booking_intro',
      lastQuestionKey: 'booking_intro',
      profile: withTracking(profile, {
        ...baseProfile,
        phase13UrlShared: false,
        phase13Outcome: 'cta_presented',
      }),
    },
    clearState: false,
    analytics: [
      { type: 'phase13_started', service: dest.service, entry: entryMode },
      { type: 'booking_service_selected', service: dest.service },
      { type: 'booking_cta_presented', service: dest.service },
    ],
  };
}

/**
 * Resume booking without replaying Phases 9–12.
 */
function tryBookingResume(text, context = {}, opts = {}) {
  const {
    detectBookingResume,
  } = require('./careerCounsellingV2BookingOrchestratorParser');
  const { getBookableServiceKey } = require('./careerCounsellingV2BookingOrchestratorCore');
  const detected = detectBookingResume(text);
  if (!detected.matched) return null;

  const profile = context.profile || {};
  const analyticsMeta = opts.analytics || {};

  // Already inside Phase 13 — let the turn processor handle Book now
  if (isPhase13Stage(context.stage) || isPhase13Step(context.step)) {
    return null;
  }

  // Sticky invitation / NIAT stages own their flows
  if (
    context.stage === 'counseling_invitation' ||
    context.stage === 'niat_interest_one_on_one' ||
    String(context.step || '').startsWith('invite_') ||
    context.step === 'niat_one_on_one_offer'
  ) {
    return null;
  }

  const bookable = getBookableServiceKey(profile);
  const isComplete =
    context.stage === STAGES.CONVERSATION_COMPLETE ||
    context.step === 'conversation_complete';
  const pastCounselingSelection =
    Boolean(profile.phase12Presented) ||
    Boolean(profile.phase12Service) ||
    Boolean(profile.phase13Service);

  // Do not interrupt Phases 1–11 when no bookable service is stored yet
  if (!bookable && !isComplete && !pastCounselingSelection) {
    return null;
  }

  logBookingResume({
    stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
    service: profile.phase12Service || profile.phase13Service || null,
    resumePhrase: detected.phrase,
    ...analyticsMeta,
  });

  const skip = shouldSkipPhase13(profile);
  if (skip.skip) {
    if (skip.reason === 'service_none' || skip.reason === 'no_service') {
      return {
        reply: getPhase13Message('resume_no_service'),
        context,
        clearState: false,
        analytics: [{ type: 'booking_resume', matched: false, reason: skip.reason }],
      };
    }
    return presentSkipComplete(context, skip, analyticsMeta);
  }

  return startBookingOrchestrator(context, analyticsMeta, {
    entry: 'booking_resume',
    shareUrlImmediately: detected.shareUrlImmediately,
  });
}

function getBookableFromProfile(profile = {}) {
  const { getBookableServiceKey } = require('./careerCounsellingV2BookingOrchestratorCore');
  if (shouldSkipPhase13(profile).skip) return false;
  return Boolean(getBookableServiceKey(profile));
}

async function processBookingOrchestratorTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startBookingOrchestrator ||
    ctx.step === 'phase13_booking_placeholder' ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    ctx.step === 'journey_completed' ||
    ctx.step === 'phase13_booking_orchestrator_placeholder' ||
    (isPhase13Stage(ctx.stage) &&
      !PHASE13_STEPS.includes(ctx.step) &&
      ctx.step !== 'conversation_complete')
  ) {
    return startBookingOrchestrator(ctx, analyticsMeta, {
      entry: opts.entry || 'phase12_continue',
      shareUrlImmediately: opts.shareUrlImmediately,
    });
  }

  if (ctx.stage === STAGES.CONVERSATION_COMPLETE || ctx.step === 'conversation_complete') {
    if (ctx.profile?.journeyCompleted === true) {
      const {
        processJourneyCompletionTurn,
      } = require('./careerCounsellingV2JourneyCompletionEngine');
      return processJourneyCompletionTurn(inbound, ctx, { analytics: analyticsMeta });
    }
    // Already closed via Phase 13 flags but not Phase 14 — complete now
    if (ctx.profile?.phase13Completed || ctx.profile?.phase13Outcome) {
      return exitToPhase14(ctx, analyticsMeta);
    }
    // Sticky complete may re-share via Book now / resume language
    if (isPhase13BookNow(inbound) && getBookableFromProfile(ctx.profile || {})) {
      const dest = resolveBookingDestination(ctx.profile || {});
      if (dest.ok) {
        return shareOfficialUrl(ctx, dest, analyticsMeta, {
          phase13Entry: 'booking_resume',
        });
      }
    }
    return {
      reply: getPhase13Message('complete_sticky'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isCareerCounsellingJourneyBreakout(inbound)) {
    return {
      reply: BREAKOUT_DEFLECTION,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isSocialGreetingOnly(inbound)) {
    return {
      reply: getPhase13Message('greeting_mid'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'booking_intro') {
    if (isPhase13Defer(inbound)) {
      logBookingDeferred({
        stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
        service: ctx.profile?.phase13Service || null,
        ...analyticsMeta,
      });
      return exitToPhase14(
        {
          ...ctx,
          profile: withTracking(ctx.profile || {}, {
            phase13Outcome: 'deferred',
            phase13Completed: true,
          }),
        },
        analyticsMeta
      );
    }

    if (isPhase13BookNow(inbound) && !isPhase13Question(inbound)) {
      const dest = resolveBookingDestination(ctx.profile || {});
      if (!dest.ok) {
        return presentAbandoned(ctx, dest.reason || 'unmapped_service', analyticsMeta);
      }
      return shareOfficialUrl(ctx, dest, analyticsMeta);
    }

    if (isPhase13Question(inbound) || inbound.length >= 4) {
      return {
        reply: getPhase13Message('question_fallback'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }

    return {
      reply: getPhase13Message('clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'booking_presented' || ctx.step === 'booking_confirmed') {
    if (isPhase13Defer(inbound)) {
      return exitToPhase14(
        {
          ...ctx,
          profile: withTracking(ctx.profile || {}, {
            phase13Outcome: 'confirmed_intent',
            phase13Completed: true,
          }),
        },
        analyticsMeta
      );
    }

    if (isPhase13BookNow(inbound)) {
      const dest = resolveBookingDestination(ctx.profile || {});
      if (dest.ok) return shareOfficialUrl(ctx, dest, analyticsMeta);
    }

    if (isPhase13Question(inbound) || inbound.length >= 4) {
      return {
        reply: getPhase13Message('question_fallback'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }

    // Soft ack after URL share → booking_initiated via Phase 14
    return exitToPhase14(
      {
        ...ctx,
        step: 'booking_confirmed',
        profile: withTracking(ctx.profile || {}, {
          phase13Outcome: 'confirmed_intent',
          phase13Completed: true,
        }),
      },
      analyticsMeta
    );
  }

  return startBookingOrchestrator(ctx, analyticsMeta, {
    entry: opts.entry || 'phase12_continue',
  });
}

module.exports = {
  STAGES,
  PHASE13_STEPS,
  PHASE13_ENGINE_VERSION,
  startBookingOrchestrator,
  processBookingOrchestratorTurn,
  tryBookingResume,
  shouldSkipPhase13,
  isPhase13Stage,
  isPhase13Step,
};
