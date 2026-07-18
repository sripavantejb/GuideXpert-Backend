'use strict';

const {
  STAGES,
  PHASE10_STEPS,
  PHASE10_ENGINE_VERSION,
  getPhase10Message,
} = require('../../../constants/careerCounsellingV2FuturePathVision');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  isVisionContinue,
  isVisionQuestion,
  answerVisionQuestion,
} = require('./careerCounsellingV2FuturePathVisionParser');
const {
  synthesizeFuturePathVision,
} = require('./careerCounsellingV2FuturePathVisionCore');
const {
  logPhase10VisionStarted,
  logPhase10VisionPresented,
  logPhase10VisionContinued,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function startFuturePathVision(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const vision = synthesizeFuturePathVision(profile);

  logPhase10VisionStarted({
    stage: STAGES.PHASE_10_FUTURE_PATH_VISION,
    personalized: vision.personalized,
    bestMatch: vision.bestMatch,
    ...analyticsMeta,
  });
  logPhase10VisionPresented({
    stage: STAGES.PHASE_10_FUTURE_PATH_VISION,
    bubbleCount: vision.bubbles.length,
    personalized: vision.personalized,
    ...analyticsMeta,
  });

  const nextProfile = {
    ...profile,
    futurePathVisionPresented: true,
    futurePathVisionBestMatch: vision.bestMatch,
    futurePathVisionPersonalized: vision.personalized,
    phase10EngineVersion: PHASE10_ENGINE_VERSION,
  };

  logProfileUpdated({
    stage: STAGES.PHASE_10_FUTURE_PATH_VISION,
    fieldsUpdated: ['futurePathVisionPresented', 'phase10EngineVersion'],
    ...analyticsMeta,
  });

  return {
    reply: vision.reply,
    context: {
      ...ctx,
      stage: STAGES.PHASE_10_FUTURE_PATH_VISION,
      step: 'vision_followup',
      profile: nextProfile,
      lastQuestionKey: 'vision_continue',
      phase10StartedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'phase10_vision_started' },
      { type: 'phase10_vision_presented' },
    ],
  };
}

async function processFuturePathVisionTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startFuturePathVision ||
    ctx.step === 'phase10_future_path_vision_placeholder' ||
    (ctx.stage === STAGES.PHASE_10_FUTURE_PATH_VISION &&
      !PHASE10_STEPS.includes(ctx.step) &&
      ctx.step !== 'phase11_final_decision_hesitation_placeholder' &&
      ctx.step !== 'phase12_personalized_counseling_recommendation_placeholder' &&
      ctx.step !== 'phase13_booking_placeholder' &&
      !String(ctx.step || '').startsWith('hesitation_') &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      !String(ctx.step || '').startsWith('invite_') &&
      ctx.step !== 'conversation_complete')
  ) {
    return startFuturePathVision(ctx, analyticsMeta);
  }

  if (
    ctx.stage === STAGES.PHASE_11_FINAL_DECISION_HESITATION ||
    ctx.step === 'phase11_final_decision_hesitation_placeholder' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('hesitation_'))
  ) {
    const {
      processFinalDecisionHesitationTurn,
    } = require('./careerCounsellingV2FinalDecisionHesitationEngine');
    return processFinalDecisionHesitationTurn(inbound, ctx, {
      startFinalDecisionHesitation:
        ctx.step === 'phase11_final_decision_hesitation_placeholder' ||
        opts.startFinalDecisionHesitation,
      analytics: analyticsMeta,
    });
  }

  if (
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
      processCounselingExperienceSelectionTurn,
    } = require('./careerCounsellingV2CounselingExperienceSelectionEngine');
    return processCounselingExperienceSelectionTurn(inbound, ctx, {
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
      reply: `${getPhase10Message('greeting_mid')}\n\n${getPhase10Message('ask_continue')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'vision_followup' || ctx.step === 'vision_present') {
    if (isVisionContinue(inbound) && !isVisionQuestion(inbound)) {
      logPhase10VisionContinued({
        stage: STAGES.PHASE_10_FUTURE_PATH_VISION,
        ...analyticsMeta,
      });
      const {
        processFinalDecisionHesitationTurn,
      } = require('./careerCounsellingV2FinalDecisionHesitationEngine');
      return processFinalDecisionHesitationTurn(inbound, ctx, {
        startFinalDecisionHesitation: true,
        analytics: analyticsMeta,
      });
    }

    if (isVisionQuestion(inbound) || inbound.length >= 4) {
      const canned = answerVisionQuestion(inbound);
      const reply = [
        canned ||
          'This step is about possible learning and growth on your path — not new rankings or promises.',
        '',
        getPhase10Message('ask_continue'),
      ].join('\n');
      return {
        reply,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }

    return {
      reply: getPhase10Message('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startFuturePathVision(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  PHASE10_STEPS,
  startFuturePathVision,
  processFuturePathVisionTurn,
};
