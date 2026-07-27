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
  EXPLORE_STEPS,
  processExploreModernCollegesTurn,
  startExploreModernColleges,
} = require('./careerCounsellingV2ExploreModernCollegesEngine');
const {
  optimizeCareerCounsellingReply,
} = require('./careerCounsellingV2ResponseOptimizer');
const {
  composeCounselorReply,
} = require('./careerCounsellingV2PhaseOrchestrator');
const {
  tryNiatInterestTransition,
  processNiatInterestFollowUp,
  NIAT_INTEREST_STAGE,
  NIAT_INTEREST_STEP,
  detectNiatInterest,
} = require('./careerCounsellingV2NiatInterestService');

function finalizeCounselingResult(result, inbound = '') {
  const composed = composeCounselorReply(result || {}, inbound);
  const optimized = optimizeCareerCounsellingReply(composed.reply, {
    allowExtendedPrediction: composed.allowExtendedPrediction,
    skipLineCap: composed.skipLineCap,
    educationalContent: composed.educationalContent,
    keepIntact: composed.keepIntact === true || result?.keepIntact === true,
  });
  return {
    ...composed,
    reply: optimized.reply,
    // Intact Stage 3 bubbles must never multi-send via replyParts.
    replyParts:
      composed.keepIntact === true || result?.keepIntact === true
        ? [optimized.reply].filter(Boolean)
        : optimized.replyParts,
    syncConversationLanguage: result?.syncConversationLanguage || null,
  };
}

async function handleCareerCounsellingMessage(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const ctx = { ...context };

  // Sticky NIAT One-on-One offer follow-up
  if (ctx.stage === NIAT_INTEREST_STAGE || ctx.step === NIAT_INTEREST_STEP) {
    const sticky = processNiatInterestFollowUp(inbound, ctx);
    return finalizeCounselingResult(
      { ...sticky, allowSkipAdvance: true },
      inbound
    );
  }

  // Admission-guidance transition — immediate, separate from Phase 11 escalation
  const niatTransition = tryNiatInterestTransition(inbound, ctx, opts);
  if (niatTransition) {
    return finalizeCounselingResult(
      { ...niatTransition, allowSkipAdvance: Boolean(niatTransition.allowSkipAdvance) },
      inbound
    );
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
    const outcome = ctx.profile?.journeyOutcome;
    if (
      (outcome === 'booking_deferred' || outcome === 'information_only') &&
      tryBookingResume
    ) {
      const resumeAttempt = tryBookingResume(
        inbound,
        {
          ...ctx,
          profile: {
            ...ctx.profile,
            journeyCompleted: false,
          },
          stage: 'conversation_complete',
          step: 'conversation_complete',
        },
        { analytics: opts.analytics }
      );
      if (resumeAttempt && resumeAttempt.context?.stage !== 'journey_completed') {
        return finalizeCounselingResult(resumeAttempt, inbound);
      }
    }

    const sticky14 = await processJourneyCompletionTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    return finalizeCounselingResult(
      { ...sticky14, allowSkipAdvance: true },
      inbound
    );
  }

  if (
    isPhase13Stage(ctx.stage) ||
    (typeof ctx.step === 'string' && String(ctx.step).startsWith('booking_'))
  ) {
    const {
      isPostBookingUnlocked,
      isPostBookingControlPhrase,
      processPostBookingAssistTurn,
    } = require('./careerCounsellingV2PostBookingAssist');

    // After Done: unlock content Q&A; only booking-control phrases stay in Phase 13.
    if (isPostBookingUnlocked(ctx) && !isPostBookingControlPhrase(inbound)) {
      const assist = processPostBookingAssistTurn(inbound, ctx, {
        analytics: opts.analytics,
      });
      return finalizeCounselingResult(assist, inbound);
    }

    const bookingTurn = await processBookingOrchestratorTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    return finalizeCounselingResult(bookingTurn, inbound);
  }

  // Sticky complete after Phase 13 flags — route to Phase 14 if not yet completed
  if (
    (ctx.stage === 'conversation_complete' || ctx.step === 'conversation_complete') &&
    (ctx.profile?.phase13CtaPresented ||
      ctx.profile?.phase13Service ||
      ctx.profile?.phase12ExitTarget === 'phase_13_booking_orchestrator' ||
      ctx.profile?.phase12ExitTarget === 'phase_14_journey_completion')
  ) {
    if (
      ctx.profile?.phase13Completed ||
      ctx.profile?.phase13Outcome ||
      ctx.profile?.phase12Outcome === 'declined' ||
      ctx.profile?.phase12Outcome === 'continued_none'
    ) {
      const closed = startJourneyCompletion(ctx, opts.analytics || {});
      return finalizeCounselingResult({ ...closed, allowSkipAdvance: true }, inbound);
    }
    const sticky = await processBookingOrchestratorTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    return finalizeCounselingResult(sticky, inbound);
  }

  const resume = tryBookingResume(inbound, ctx, { analytics: opts.analytics });
  if (resume) {
    return finalizeCounselingResult(resume, inbound);
  }

  // Explore modern colleges sticky / continue
  if (
    ctx.stage === 'explore_modern_colleges' ||
    (typeof ctx.step === 'string' && String(ctx.step).startsWith('explore_'))
  ) {
    const exploreTurn = await processExploreModernCollegesTurn(inbound, ctx, {
      analytics: opts.analytics,
    });
    return finalizeCounselingResult(exploreTurn, inbound);
  }

  const result = await processDiscoveryTurn(text, context, opts);
  return finalizeCounselingResult(result, inbound);
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
  EXPLORE_STEPS,
  emptyProfile,
  initialContext,
  handleCareerCounsellingMessage,
  finalizeCounselingResult,
  processEvaluationTurn,
  startEvaluation,
  processModernEducationTurn,
  startModernEducation,
  processPersonalizedDiscoveryTurn,
  startPersonalizedDiscovery,
  processExploreModernCollegesTurn,
  startExploreModernColleges,
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
