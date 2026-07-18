'use strict';

const {
  STAGES,
  PHASE9_STEPS,
  PHASE9_ENGINE_VERSION,
  getPhase9Message,
} = require('../../../constants/careerCounsellingV2PersonalizedRecommendation');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  isPhase9Continue,
  isPhase9Question,
  answerPhase9Question,
} = require('./careerCounsellingV2PersonalizedRecommendationParser');
const {
  synthesizePersonalizedRecommendation,
} = require('./careerCounsellingV2PersonalizedRecommendationCore');
const {
  logPhase9RecommendationStarted,
  logPhase9RecommendationSynthesized,
  logPhase9RecommendationPresented,
  logPhase9RecommendationContinued,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function startPhase9PersonalizedRecommendation(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const synthesis = synthesizePersonalizedRecommendation(profile);

  logPhase9RecommendationStarted({
    stage: STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION,
    itemCount: synthesis.items.length,
    ...analyticsMeta,
  });
  logPhase9RecommendationSynthesized({
    stage: STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION,
    itemCount: synthesis.items.length,
    overallConfidenceLabel: synthesis.overallConfidenceLabel,
    weakConfidence: synthesis.weakConfidence,
    summary: synthesis.summary,
    ...analyticsMeta,
  });
  logPhase9RecommendationPresented({
    stage: STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION,
    itemCount: synthesis.items.length,
    ...analyticsMeta,
  });

  const nextProfile = {
    ...profile,
    phase9Recommendations: synthesis.items.map((i) => ({
      collegeName: i.collegeName,
      branchName: i.branchName,
      rankLabel: i.rankLabel,
      confidenceLabel: i.confidenceLabel,
      tier: i.tier,
    })),
    phase9OverallConfidenceLabel: synthesis.overallConfidenceLabel,
    phase9Tradeoffs: synthesis.tradeoffs,
    phase9ComparisonInsight: synthesis.comparisonInsight || null,
    phase9Summary: synthesis.summary,
    phase9Presented: true,
    phase9EngineVersion: PHASE9_ENGINE_VERSION,
  };

  logProfileUpdated({
    stage: STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION,
    fieldsUpdated: [
      'phase9Recommendations',
      'phase9OverallConfidenceLabel',
      'phase9Presented',
    ],
    ...analyticsMeta,
  });

  return {
    reply: synthesis.reply,
    context: {
      ...ctx,
      stage: STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION,
      step: 'phase9_followup',
      profile: nextProfile,
      lastQuestionKey: 'phase9_continue',
      phase9StartedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'phase9_recommendation_started' },
      { type: 'phase9_recommendation_synthesized' },
      { type: 'phase9_recommendation_presented' },
    ],
  };
}

async function processPhase9PersonalizedRecommendationTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startPhase9PersonalizedRecommendation ||
    ctx.step === 'phase9_personalized_recommendation_placeholder' ||
    (ctx.stage === STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION &&
      !PHASE9_STEPS.includes(ctx.step) &&
      ctx.step !== 'phase10_future_path_vision_placeholder' &&
      !String(ctx.step || '').startsWith('vision_') &&
      ctx.step !== 'phase11_final_decision_hesitation_placeholder' &&
      ctx.step !== 'phase12_personalized_counseling_recommendation_placeholder' &&
      ctx.step !== 'phase13_booking_placeholder' &&
      !String(ctx.step || '').startsWith('hesitation_') &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      !String(ctx.step || '').startsWith('invite_') &&
      ctx.step !== 'conversation_complete')
  ) {
    return startPhase9PersonalizedRecommendation(ctx, analyticsMeta);
  }

  if (
    ctx.stage === STAGES.PHASE_10_FUTURE_PATH_VISION ||
    ctx.step === 'phase10_future_path_vision_placeholder' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('vision_')) ||
    ctx.stage === STAGES.PHASE_11_FINAL_DECISION_HESITATION ||
    ctx.step === 'phase11_final_decision_hesitation_placeholder' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('hesitation_')) ||
    ctx.stage === STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION ||
    ctx.stage === STAGES.PHASE_13_BOOKING_ORCHESTRATOR ||
    ctx.stage === STAGES.PHASE_13_BOOKING_PLACEHOLDER ||
    ctx.stage === STAGES.PHASE_14_JOURNEY_COMPLETION ||
    ctx.stage === STAGES.JOURNEY_COMPLETED ||
    ctx.step === 'phase12_personalized_counseling_recommendation_placeholder' ||
    ctx.step === 'phase13_booking_placeholder' ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    ctx.step === 'journey_completed' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('counsel_rec_') ||
        ctx.step.startsWith('booking_'))
  ) {
    const {
      processFuturePathVisionTurn,
    } = require('./careerCounsellingV2FuturePathVisionEngine');
    return processFuturePathVisionTurn(inbound, ctx, {
      startFuturePathVision:
        ctx.step === 'phase10_future_path_vision_placeholder' ||
        opts.startFuturePathVision,
      startFinalDecisionHesitation:
        ctx.step === 'phase11_final_decision_hesitation_placeholder' ||
        opts.startFinalDecisionHesitation,
      startCounselingExperienceSelection:
        ctx.step === 'phase12_personalized_counseling_recommendation_placeholder' ||
        opts.startCounselingExperienceSelection,
      analytics: analyticsMeta,
    });
  }

  if (
    ctx.stage === STAGES.COUNSELING_INVITATION ||
    ctx.stage === STAGES.COUNSELING_INVITATION_PLACEHOLDER ||
    ctx.stage === STAGES.CONVERSATION_COMPLETE ||
    ctx.step === 'counseling_invitation_placeholder' ||
    ctx.step === 'conversation_complete' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('invite_'))
  ) {
    const {
      processCounselingInvitationTurn,
    } = require('./careerCounsellingV2CounselingInvitationEngine');
    return processCounselingInvitationTurn(inbound, ctx, {
      startCounselingInvitation:
        ctx.step === 'counseling_invitation_placeholder' ||
        opts.startCounselingInvitation ||
        (ctx.stage === STAGES.COUNSELING_INVITATION_PLACEHOLDER &&
          !String(ctx.step || '').startsWith('invite_')),
      analytics: analyticsMeta,
    });
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
      reply: `${getPhase9Message('greeting_mid')}\n\n${getPhase9Message('ask_continue')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'phase9_followup' || ctx.step === 'phase9_present') {
    if (isPhase9Continue(inbound) && !isPhase9Question(inbound)) {
      logPhase9RecommendationContinued({
        stage: STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION,
        ...analyticsMeta,
      });
      const {
        processFuturePathVisionTurn,
      } = require('./careerCounsellingV2FuturePathVisionEngine');
      return processFuturePathVisionTurn(inbound, ctx, {
        startFuturePathVision: true,
        analytics: analyticsMeta,
      });
    }

    if (isPhase9Question(inbound) || inbound.length >= 4) {
      const canned = answerPhase9Question(inbound);
      const reply = [
        canned ||
          'I can clarify fit, trade-offs, or confidence — all from your shortlist and comparison context.',
        '',
        getPhase9Message('ask_continue'),
      ].join('\n');
      return {
        reply,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }

    return {
      reply: getPhase9Message('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startPhase9PersonalizedRecommendation(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  PHASE9_STEPS,
  startPhase9PersonalizedRecommendation,
  processPhase9PersonalizedRecommendationTurn,
};
