'use strict';

const {
  FLOW_ID,
  STAGES,
  DISCOVERY_STEPS,
  emptyProfile,
  initialContext,
  processDiscoveryTurn,
} = require('./careerCounsellingV2DiscoveryEngine');
const {
  EVALUATION_STEPS,
  processEvaluationTurn,
  startEvaluation,
} = require('./careerCounsellingV2EvaluationEngine');
const {
  MODERN_EDUCATION_STEPS,
  processModernEducationTurn,
  startModernEducation,
} = require('./careerCounsellingV2ModernEducationEngine');
const {
  PERSONALIZATION_STEPS,
  processPersonalizedDiscoveryTurn,
  startPersonalizedDiscovery,
} = require('./careerCounsellingV2PersonalizationEngine');
const {
  SHORTLISTING_STEPS,
  processAiShortlistingTurn,
  startAiShortlisting,
} = require('./careerCounsellingV2ShortlistingEngine');
const {
  COMPARISON_STEPS,
  processSmartComparisonTurn,
  startSmartComparison,
} = require('./careerCounsellingV2ComparisonEngine');
const {
  CONCERN_RESOLUTION_STEPS,
  processConcernResolutionTurn,
  startConcernResolution,
} = require('./careerCounsellingV2ConcernResolutionEngine');
const {
  PHASE9_STEPS,
  processPhase9PersonalizedRecommendationTurn,
  startPhase9PersonalizedRecommendation,
} = require('./careerCounsellingV2PersonalizedRecommendationEngine');
const {
  PHASE10_STEPS,
  processFuturePathVisionTurn,
  startFuturePathVision,
} = require('./careerCounsellingV2FuturePathVisionEngine');
const {
  PHASE11_STEPS,
  processFinalDecisionHesitationTurn,
  startFinalDecisionHesitation,
} = require('./careerCounsellingV2FinalDecisionHesitationEngine');
const {
  PHASE12_STEPS,
  processCounselingExperienceSelectionTurn,
  startCounselingExperienceSelection,
} = require('./careerCounsellingV2CounselingExperienceSelectionEngine');
const {
  PHASE13_STEPS,
  processBookingOrchestratorTurn,
  startBookingOrchestrator,
  tryBookingResume,
} = require('./careerCounsellingV2BookingOrchestratorEngine');
const {
  PHASE14_STEPS,
  processJourneyCompletionTurn,
  startJourneyCompletion,
} = require('./careerCounsellingV2JourneyCompletionEngine');
const {
  INVITATION_STEPS,
  processCounselingInvitationTurn,
  startCounselingInvitation,
} = require('./careerCounsellingV2CounselingInvitationEngine');
const {
  optimizeCareerCounsellingReply,
} = require('./careerCounsellingV2ResponseOptimizer');
const {
  tryNiatInterestTransition,
  processNiatInterestFollowUp,
  NIAT_INTEREST_STAGE,
  NIAT_INTEREST_STEP,
  detectNiatInterest,
} = require('./careerCounsellingV2NiatInterestService');

async function handleCareerCounsellingMessage(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const ctx = { ...context };

  // Sticky NIAT One-on-One offer follow-up
  if (ctx.stage === NIAT_INTEREST_STAGE || ctx.step === NIAT_INTEREST_STEP) {
    const sticky = processNiatInterestFollowUp(inbound, ctx);
    const optimizedSticky = optimizeCareerCounsellingReply(sticky.reply);
    return {
      ...sticky,
      reply: optimizedSticky.reply,
      replyParts: optimizedSticky.replyParts,
    };
  }

  // Admission-guidance transition — immediate, separate from Phase 11 escalation
  const niatTransition = tryNiatInterestTransition(inbound, ctx, opts);
  if (niatTransition) {
    const optimizedNiat = optimizeCareerCounsellingReply(niatTransition.reply);
    return {
      ...niatTransition,
      reply: optimizedNiat.reply,
      replyParts: optimizedNiat.replyParts,
    };
  }

  const {
    tryBookingResume,
    processBookingOrchestratorTurn,
    isPhase13Stage,
  } = require('./careerCounsellingV2BookingOrchestratorEngine');
  const {
    processJourneyCompletionTurn,
    isPhase14Stage,
    startJourneyCompletion,
  } = require('./careerCounsellingV2JourneyCompletionEngine');

  // Phase 14 terminal sticky
  if (
    ctx.profile?.journeyCompleted === true ||
    isPhase14Stage(ctx.stage) ||
    ctx.step === 'journey_completed'
  ) {
    // Allow booking resume after deferred / information_only without replaying 9–12
    const outcome = ctx.profile?.journeyOutcome;
    if (
      (outcome === 'booking_deferred' || outcome === 'information_only') &&
      tryBookingResume
    ) {
      const resumeAttempt = tryBookingResume(inbound, {
        ...ctx,
        profile: {
          ...ctx.profile,
          journeyCompleted: false,
        },
        stage: 'conversation_complete',
        step: 'conversation_complete',
      }, { analytics: opts.analytics });
      if (resumeAttempt && resumeAttempt.context?.stage !== 'journey_completed') {
        const optimizedResume = optimizeCareerCounsellingReply(resumeAttempt.reply);
        return {
          ...resumeAttempt,
          reply: optimizedResume.reply,
          replyParts: optimizedResume.replyParts,
        };
      }
    }

    const sticky14 = await processJourneyCompletionTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    const optimized14 = optimizeCareerCounsellingReply(sticky14.reply);
    return {
      ...sticky14,
      reply: optimized14.reply,
      replyParts: optimized14.replyParts,
    };
  }

  if (isPhase13Stage(ctx.stage) || (typeof ctx.step === 'string' && String(ctx.step).startsWith('booking_'))) {
    const bookingTurn = await processBookingOrchestratorTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    const optimizedBooking = optimizeCareerCounsellingReply(bookingTurn.reply);
    return {
      ...bookingTurn,
      reply: optimizedBooking.reply,
      replyParts: optimizedBooking.replyParts,
    };
  }

  // Sticky complete after Phase 13 flags — route to Phase 14 if not yet completed
  if (
    (ctx.stage === 'conversation_complete' || ctx.step === 'conversation_complete') &&
    (ctx.profile?.phase13CtaPresented ||
      ctx.profile?.phase13Service ||
      ctx.profile?.phase12ExitTarget === 'phase_13_booking_orchestrator' ||
      ctx.profile?.phase12ExitTarget === 'phase_14_journey_completion')
  ) {
    if (ctx.profile?.phase13Completed || ctx.profile?.phase13Outcome || ctx.profile?.phase12Outcome === 'declined' || ctx.profile?.phase12Outcome === 'continued_none') {
      const closed = startJourneyCompletion(ctx, opts.analytics || {});
      const optimizedClosed = optimizeCareerCounsellingReply(closed.reply);
      return {
        ...closed,
        reply: optimizedClosed.reply,
        replyParts: optimizedClosed.replyParts,
      };
    }
    const sticky = await processBookingOrchestratorTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    const optimizedSticky = optimizeCareerCounsellingReply(sticky.reply);
    return {
      ...sticky,
      reply: optimizedSticky.reply,
      replyParts: optimizedSticky.replyParts,
    };
  }

  const resume = tryBookingResume(inbound, ctx, { analytics: opts.analytics });
  if (resume) {
    const optimizedResume = optimizeCareerCounsellingReply(resume.reply);
    return {
      ...resume,
      reply: optimizedResume.reply,
      replyParts: optimizedResume.replyParts,
    };
  }

  const result = await processDiscoveryTurn(text, context, opts);
  const optimized = optimizeCareerCounsellingReply(result.reply);
  return {
    ...result,
    reply: optimized.reply,
    replyParts: optimized.replyParts,
  };
}

module.exports = {
  FLOW_ID,
  STAGES,
  DISCOVERY_STEPS,
  EVALUATION_STEPS,
  MODERN_EDUCATION_STEPS,
  PERSONALIZATION_STEPS,
  SHORTLISTING_STEPS,
  COMPARISON_STEPS,
  CONCERN_RESOLUTION_STEPS,
  PHASE9_STEPS,
  PHASE10_STEPS,
  PHASE11_STEPS,
  PHASE12_STEPS,
  PHASE13_STEPS,
  PHASE14_STEPS,
  INVITATION_STEPS,
  emptyProfile,
  initialContext,
  handleCareerCounsellingMessage,
  processEvaluationTurn,
  startEvaluation,
  processModernEducationTurn,
  startModernEducation,
  processPersonalizedDiscoveryTurn,
  startPersonalizedDiscovery,
  processAiShortlistingTurn,
  startAiShortlisting,
  processSmartComparisonTurn,
  startSmartComparison,
  processConcernResolutionTurn,
  startConcernResolution,
  processPhase9PersonalizedRecommendationTurn,
  startPhase9PersonalizedRecommendation,
  processFuturePathVisionTurn,
  startFuturePathVision,
  processFinalDecisionHesitationTurn,
  startFinalDecisionHesitation,
  processCounselingExperienceSelectionTurn,
  startCounselingExperienceSelection,
  processBookingOrchestratorTurn,
  startBookingOrchestrator,
  tryBookingResume,
  processJourneyCompletionTurn,
  startJourneyCompletion,
  processCounselingInvitationTurn,
  startCounselingInvitation,
  detectNiatInterest,
  tryNiatInterestTransition,
};
