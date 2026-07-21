'use strict';

const {
  STAGES,
  PHASE12_STEPS,
  PHASE12_ENGINE_VERSION,
  COUNSELING_SERVICES,
  getPhase12Message,
} = require('../../../constants/careerCounsellingV2CounselingExperienceSelection');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  isPhase12Continue,
  isPhase12Decline,
  isPhase12Question,
} = require('./careerCounsellingV2CounselingExperienceSelectionParser');
const {
  shouldSkipPhase12,
  selectCounselingService,
  buildPersonalizedServiceReply,
} = require('./careerCounsellingV2CounselingExperienceSelectionCore');
const {
  logPhase12Started,
  logPhase12ServiceSelected,
  logPhase12Presented,
  logPhase12Continue,
  logPhase12Declined,
  logPhase12Skipped,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function withTracking(profile = {}, patch = {}) {
  return { ...profile, ...patch };
}

function presentSkipComplete(ctx, skip, analyticsMeta = {}) {
  logPhase12Skipped({
    stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
    skipReason: skip.reason,
    ...analyticsMeta,
  });

  return {
    reply: getPhase12Message('skipped_already_offered'),
    context: {
      ...ctx,
      stage: STAGES.CONVERSATION_COMPLETE,
      step: 'conversation_complete',
      profile: withTracking(ctx.profile || {}, {
        phase12Skipped: true,
        phase12SkipReason: skip.reason,
        phase12Outcome: 'skipped_already_offered',
        phase12EngineVersion: PHASE12_ENGINE_VERSION,
      }),
    },
    clearState: false,
    analytics: [{ type: 'phase12_skipped', skipReason: skip.reason }],
  };
}

function exitToPhase13(ctx, analyticsMeta = {}) {
  logPhase12Continue({
    stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
    service: ctx.profile?.phase12Service || null,
    ...analyticsMeta,
  });

  const service = ctx.profile?.phase12Service;
  // Skip Phase 13 completely when service is none → Phase 14 information_only
  if (service === COUNSELING_SERVICES.NONE) {
    const {
      startJourneyCompletion,
    } = require('./careerCounsellingV2JourneyCompletionEngine');
    return startJourneyCompletion(
      {
        ...ctx,
        profile: withTracking(ctx.profile || {}, {
          phase12Outcome: 'continued_none',
          phase12Completed: true,
          phase12ExitTarget: 'phase_14_journey_completion',
        }),
      },
      analyticsMeta
    );
  }

  const {
    startBookingOrchestrator,
  } = require('./careerCounsellingV2BookingOrchestratorEngine');
  return startBookingOrchestrator(
    {
      ...ctx,
      profile: withTracking(ctx.profile || {}, {
        phase12Outcome: 'continued',
        phase12Completed: true,
        phase12ExitTarget: 'phase_13_booking_orchestrator',
      }),
    },
    analyticsMeta,
    { entry: 'phase12_continue' }
  );
}

function startCounselingExperienceSelection(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const skip = shouldSkipPhase12(profile);
  if (skip.skip) {
    return presentSkipComplete(ctx, skip, analyticsMeta);
  }

  logPhase12Started({
    stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
    priorExitTarget: profile.phase11ExitTarget || null,
    ...analyticsMeta,
  });

  const selection = selectCounselingService(profile);
  logPhase12ServiceSelected({
    stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
    service: selection.service,
    reasons: selection.reasons,
    ...analyticsMeta,
  });

  const built = buildPersonalizedServiceReply(profile, selection);
  logPhase12Presented({
    stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
    service: selection.service,
    reasons: selection.reasons,
    ...analyticsMeta,
  });

  const nextProfile = withTracking(profile, {
    phase12Service: selection.service,
    phase12Reasons: selection.reasons,
    phase12Presented: true,
    phase12EngineVersion: PHASE12_ENGINE_VERSION,
    phase12Outcome:
      selection.service === COUNSELING_SERVICES.NONE ? 'none_selected' : null,
  });

  logProfileUpdated({
    stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
    fieldsUpdated: ['phase12Service', 'phase12Reasons', 'phase12Presented'],
    ...analyticsMeta,
  });

  return {
    reply: built.reply,
    keepIntact: true,
    skipLineCap: true,
    context: {
      ...ctx,
      stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
      step: 'counsel_rec_followup',
      profile: nextProfile,
      lastQuestionKey: 'counsel_rec_followup',
      phase12StartedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'phase12_started' },
      { type: 'phase12_service_selected', service: selection.service },
      { type: 'phase12_presented', service: selection.service },
    ],
  };
}

async function processCounselingExperienceSelectionTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startCounselingExperienceSelection ||
    ctx.step === 'phase12_personalized_counseling_recommendation_placeholder' ||
    (ctx.stage === STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION &&
      !PHASE12_STEPS.includes(ctx.step) &&
      ctx.step !== 'phase13_booking_placeholder' &&
      ctx.step !== 'booking_intro' &&
      ctx.step !== 'booking_presented' &&
      ctx.step !== 'booking_confirmed' &&
      ctx.step !== 'booking_deferred' &&
      ctx.step !== 'conversation_complete')
  ) {
    return startCounselingExperienceSelection(ctx, analyticsMeta);
  }

  if (
    ctx.stage === STAGES.PHASE_13_BOOKING_ORCHESTRATOR ||
    ctx.stage === STAGES.PHASE_13_BOOKING_PLACEHOLDER ||
    ctx.stage === STAGES.PHASE_14_JOURNEY_COMPLETION ||
    ctx.stage === STAGES.JOURNEY_COMPLETED ||
    ctx.stage === 'phase_13_booking_orchestrator' ||
    ctx.step === 'phase13_booking_placeholder' ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    ctx.step === 'journey_completed' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('booking_'))
  ) {
    const {
      processBookingOrchestratorTurn,
    } = require('./careerCounsellingV2BookingOrchestratorEngine');
    return processBookingOrchestratorTurn(inbound, ctx, {
      startBookingOrchestrator:
        ctx.step === 'phase13_booking_placeholder' ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    ctx.step === 'journey_completed' ||
        opts.startBookingOrchestrator,
      analytics: analyticsMeta,
    });
  }

  if (ctx.stage === STAGES.CONVERSATION_COMPLETE || ctx.step === 'conversation_complete') {
    // Sticky complete may re-share via Phase 13 resume language
    const {
      processBookingOrchestratorTurn,
    } = require('./careerCounsellingV2BookingOrchestratorEngine');
    if (ctx.profile?.phase13Service || ctx.profile?.phase12Service) {
      return processBookingOrchestratorTurn(inbound, ctx, { analytics: analyticsMeta });
    }
    return {
      reply: getPhase12Message('declined'),
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
      reply: getPhase12Message('greeting_mid'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'counsel_rec_present' || ctx.step === 'counsel_rec_followup') {
    if (isPhase12Decline(inbound)) {
      logPhase12Declined({
        stage: STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION,
        service: ctx.profile?.phase12Service || null,
        ...analyticsMeta,
      });
      const {
        startJourneyCompletion,
      } = require('./careerCounsellingV2JourneyCompletionEngine');
      return startJourneyCompletion(
        {
          ...ctx,
          profile: withTracking(ctx.profile || {}, {
            phase12Outcome: 'declined',
            phase12Completed: true,
            phase12ExitTarget: 'phase_14_journey_completion',
          }),
        },
        analyticsMeta
      );
    }

    if (isPhase12Continue(inbound) && !isPhase12Question(inbound)) {
      return exitToPhase13(ctx, analyticsMeta);
    }

    if (isPhase12Question(inbound) || inbound.length >= 4) {
      return {
        reply: getPhase12Message('question_fallback'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }

    return {
      reply: getPhase12Message('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startCounselingExperienceSelection(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  PHASE12_STEPS,
  COUNSELING_SERVICES,
  startCounselingExperienceSelection,
  processCounselingExperienceSelectionTurn,
  shouldSkipPhase12,
  selectCounselingService,
};
