'use strict';

const {
  STAGES,
  CONCERN_RESOLUTION_STEPS,
  CONCERN_ENGINE_VERSION,
  getConcernMessage,
  getCategoryById,
  CONCERN_QA,
} = require('../../../constants/careerCounsellingV2ConcernResolution');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  formatActiveConcernChoices,
  parseConcernPick,
  isConcernResolvedYes,
  isConcernResolvedNo,
  isConcernContinue,
  isConcernPermissionYes,
  isConcernPermissionNo,
  isConcernQuestion,
  looksLikeNewConcern,
} = require('./careerCounsellingV2ConcernResolutionParser');
const {
  seedActiveConcerns,
  generatePersonalizedConcernResponse,
  calculateDecisionReadiness,
  appendObjectionHistory,
  mapLegacyConcern,
} = require('./careerCounsellingV2ConcernResolutionCore');
const {
  logConcernResolutionStarted,
  logConcernIdentified,
  logConcernCategoryDetected,
  logConcernAnswered,
  logConcernResolved,
  logConcernReopened,
  logDecisionReadinessCalculated,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function answerConcernMetaQuestion(text) {
  const t = String(text || '').trim();
  for (const entry of CONCERN_QA) {
    if (entry.patterns.some((re) => re.test(t))) return entry.answer;
  }
  return null;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function buildPickReply(profile) {
  const active = Array.isArray(profile.activeConcerns) ? profile.activeConcerns : [];
  if (active.length === 0) {
    return getConcernMessage('no_active_concerns');
  }
  const choices = formatActiveConcernChoices(active);
  return `${getConcernMessage('ask_pick')}\n\n${choices}`;
}

function persistReadiness(profile) {
  const decisionReadiness = calculateDecisionReadiness(profile);
  return { ...profile, decisionReadiness };
}

function startConcernResolution(ctx, analyticsMeta = {}) {
  let profile = { ...(ctx.profile || {}) };
  const active = seedActiveConcerns(profile);
  profile = {
    ...profile,
    activeConcerns: active,
    resolvedConcerns: Array.isArray(profile.resolvedConcerns) ? profile.resolvedConcerns : [],
    objectionHistory: Array.isArray(profile.objectionHistory) ? profile.objectionHistory : [],
    lastConcernCategory: profile.lastConcernCategory || null,
    decisionReadiness: profile.decisionReadiness ?? null,
    concernEngineVersion: CONCERN_ENGINE_VERSION,
  };

  logConcernResolutionStarted({
    stage: STAGES.CONCERN_RESOLUTION,
    activeCount: active.length,
    seededFromProfile: (profile.biggestConcerns || []).length,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.CONCERN_RESOLUTION,
    fieldsUpdated: ['activeConcerns', 'resolvedConcerns', 'objectionHistory'],
    ...analyticsMeta,
  });

  return {
    reply: `${getConcernMessage('concern_intro')}\n\n${buildPickReply(profile)}`,
    context: {
      ...ctx,
      stage: STAGES.CONCERN_RESOLUTION,
      step: 'concern_pick',
      profile,
      lastQuestionKey: 'concern_pick',
      concernResolutionStartedAt: new Date().toISOString(),
      currentConcernCategory: null,
    },
    clearState: false,
    analytics: [{ type: 'concern_resolution_started' }],
  };
}

function respondToConcern(ctx, category, objectionText, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const catId = mapLegacyConcern(category);
  const active = uniq([...(profile.activeConcerns || []), catId]);
  const response = generatePersonalizedConcernResponse(profile, catId, objectionText);

  logConcernIdentified({
    stage: STAGES.CONCERN_RESOLUTION,
    category: catId,
    source: objectionText ? 'student' : 'profile',
    ...analyticsMeta,
  });
  logConcernCategoryDetected({
    stage: STAGES.CONCERN_RESOLUTION,
    category: catId,
    label: getCategoryById(catId).label,
    ...analyticsMeta,
  });
  logConcernAnswered({
    stage: STAGES.CONCERN_RESOLUTION,
    category: catId,
    ...analyticsMeta,
  });

  const nextProfile = {
    ...profile,
    activeConcerns: active.filter((id) => !(profile.resolvedConcerns || []).includes(id)),
    lastConcernCategory: catId,
    objectionHistory: appendObjectionHistory(profile, {
      category: catId,
      text: String(objectionText || '').slice(0, 200),
      action: 'answered',
    }),
  };

  return {
    reply: `${response}\n\n${getConcernMessage('check_resolved')}`,
    context: {
      ...ctx,
      stage: STAGES.CONCERN_RESOLUTION,
      step: 'concern_check_resolved',
      profile: nextProfile,
      currentConcernCategory: catId,
      lastQuestionKey: 'concern_check_resolved',
    },
    clearState: false,
    analytics: [
      { type: 'concern_identified' },
      { type: 'concern_answered' },
    ],
  };
}

function markResolved(ctx, analyticsMeta = {}) {
  const category = ctx.currentConcernCategory || ctx.profile?.lastConcernCategory;
  if (!category) {
    return {
      reply: buildPickReply(ctx.profile || {}),
      context: { ...ctx, step: 'concern_pick' },
      clearState: false,
      analytics: [],
    };
  }

  const profile = { ...(ctx.profile || {}) };
  const catId = mapLegacyConcern(category);
  const resolved = uniq([...(profile.resolvedConcerns || []), catId]);
  const active = (profile.activeConcerns || []).filter((id) => id !== catId);

  let nextProfile = {
    ...profile,
    resolvedConcerns: resolved,
    activeConcerns: active,
    lastConcernCategory: catId,
    objectionHistory: appendObjectionHistory(profile, {
      category: catId,
      action: 'resolved',
    }),
  };
  nextProfile = persistReadiness(nextProfile);

  logConcernResolved({
    stage: STAGES.CONCERN_RESOLUTION,
    category: catId,
    remainingActive: active.length,
    ...analyticsMeta,
  });
  logDecisionReadinessCalculated({
    stage: STAGES.CONCERN_RESOLUTION,
    decisionReadiness: nextProfile.decisionReadiness,
    ...analyticsMeta,
  });

  if (active.length === 0) {
    return {
      reply: `${getConcernMessage('resolved_ack')}\n\n${getConcernMessage('ask_continue')}`,
      context: {
        ...ctx,
        stage: STAGES.CONCERN_RESOLUTION,
        step: 'concern_ask_continue',
        profile: nextProfile,
        currentConcernCategory: null,
        lastQuestionKey: 'concern_continue',
      },
      clearState: false,
      analytics: [{ type: 'concern_resolved' }, { type: 'decision_readiness_calculated' }],
    };
  }

  return {
    reply: `${getConcernMessage('resolved_ack')}\n\n${buildPickReply(nextProfile)}`,
    context: {
      ...ctx,
      stage: STAGES.CONCERN_RESOLUTION,
      step: 'concern_pick',
      profile: nextProfile,
      currentConcernCategory: null,
      lastQuestionKey: 'concern_pick',
    },
    clearState: false,
    analytics: [{ type: 'concern_resolved' }, { type: 'decision_readiness_calculated' }],
  };
}

function markStillOpen(ctx, analyticsMeta = {}) {
  const category = ctx.currentConcernCategory || ctx.profile?.lastConcernCategory;
  const profile = { ...(ctx.profile || {}) };
  const catId = category ? mapLegacyConcern(category) : null;

  let nextProfile = { ...profile };
  if (catId) {
    nextProfile.activeConcerns = uniq([...(profile.activeConcerns || []), catId]);
    nextProfile.resolvedConcerns = (profile.resolvedConcerns || []).filter((id) => id !== catId);
    nextProfile.objectionHistory = appendObjectionHistory(profile, {
      category: catId,
      action: 'reopened',
    });
    logConcernReopened({
      stage: STAGES.CONCERN_RESOLUTION,
      category: catId,
      ...analyticsMeta,
    });
  }
  nextProfile = persistReadiness(nextProfile);

  const deepen = catId
    ? generatePersonalizedConcernResponse(nextProfile, catId, 'still open')
    : '';

  return {
    reply: `${getConcernMessage('still_open_ack')}${deepen ? `\n\n${deepen}` : ''}\n\n${buildPickReply(nextProfile)}`,
    context: {
      ...ctx,
      stage: STAGES.CONCERN_RESOLUTION,
      step: 'concern_pick',
      profile: nextProfile,
      currentConcernCategory: null,
      lastQuestionKey: 'concern_pick',
    },
    clearState: false,
    analytics: catId ? [{ type: 'concern_reopened' }] : [],
  };
}

function maybeFinishWithReadiness(ctx, analyticsMeta = {}) {
  let profile = persistReadiness({ ...(ctx.profile || {}) });
  logDecisionReadinessCalculated({
    stage: STAGES.CONCERN_RESOLUTION,
    decisionReadiness: profile.decisionReadiness,
    ...analyticsMeta,
  });

  return {
    reply: getConcernMessage('ask_continue'),
    context: {
      ...ctx,
      stage: STAGES.CONCERN_RESOLUTION,
      step: 'concern_ask_continue',
      profile,
      lastQuestionKey: 'concern_continue',
    },
    clearState: false,
    analytics: [{ type: 'decision_readiness_calculated' }],
  };
}

async function processConcernResolutionTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startConcernResolution ||
    ctx.step === 'concern_resolution_placeholder' ||
    (ctx.stage === STAGES.CONCERN_RESOLUTION &&
      !CONCERN_RESOLUTION_STEPS.includes(ctx.step) &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      ctx.step !== 'phase9_personalized_recommendation_placeholder' &&
      ctx.step !== 'phase10_future_path_vision_placeholder' &&
      ctx.step !== 'phase11_final_decision_hesitation_placeholder' &&
      ctx.step !== 'phase12_personalized_counseling_recommendation_placeholder' &&
      ctx.step !== 'phase13_booking_placeholder' &&
      !String(ctx.step || '').startsWith('invite_') &&
      !String(ctx.step || '').startsWith('phase9_') &&
      !String(ctx.step || '').startsWith('vision_') &&
      !String(ctx.step || '').startsWith('hesitation_') &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      ctx.step !== 'conversation_complete')
  ) {
    return startConcernResolution(ctx, analyticsMeta);
  }

  if (
    ctx.stage === STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION ||
    ctx.step === 'phase9_personalized_recommendation_placeholder' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('phase9_'))
  ) {
    const {
      processPhase9PersonalizedRecommendationTurn,
    } = require('./careerCounsellingV2PersonalizedRecommendationEngine');
    return processPhase9PersonalizedRecommendationTurn(inbound, ctx, {
      startPhase9PersonalizedRecommendation:
        ctx.step === 'phase9_personalized_recommendation_placeholder' ||
        opts.startPhase9PersonalizedRecommendation,
      analytics: analyticsMeta,
    });
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
      reply: `${getConcernMessage('greeting_mid')}\n\n${getConcernMessage('awaiting_ack_nudge')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  const metaQ = answerConcernMetaQuestion(inbound);
  if (metaQ && ctx.step !== 'concern_check_resolved') {
    return {
      reply: `${metaQ}\n\n${getConcernMessage('resume_checkpoint_prefix')}\n${buildPickReply(ctx.profile || {})}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'concern_pick' || ctx.step === 'concern_respond') {
    if (isConcernContinue(inbound) && !/\?/.test(inbound) && !looksLikeNewConcern(inbound)) {
      return maybeFinishWithReadiness(ctx, analyticsMeta);
    }

    const parsed = parseConcernPick(inbound, ctx.profile?.activeConcerns || []);
    if (!parsed) {
      return {
        reply: `${getConcernMessage('pick_clarify')}\n\n${buildPickReply(ctx.profile || {})}`,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    return respondToConcern(ctx, parsed.category, parsed.rawAnswer, analyticsMeta);
  }

  if (ctx.step === 'concern_check_resolved') {
    if (isConcernResolvedYes(inbound) && !looksLikeNewConcern(inbound)) {
      return markResolved(ctx, analyticsMeta);
    }
    if (isConcernResolvedNo(inbound) && !looksLikeNewConcern(inbound)) {
      return markStillOpen(ctx, analyticsMeta);
    }
    if (looksLikeNewConcern(inbound) || isConcernQuestion(inbound) || inbound.length >= 4) {
      // Treat as deepening / new angle of concern
      const parsed = parseConcernPick(inbound, [
        ...(ctx.profile?.activeConcerns || []),
        ctx.currentConcernCategory,
      ].filter(Boolean));
      const category = parsed?.category || ctx.currentConcernCategory || 'other';
      return respondToConcern(ctx, category, inbound, analyticsMeta);
    }
    return {
      reply: getConcernMessage('check_resolved'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'concern_ask_continue') {
    if (isConcernPermissionYes(inbound) || (isConcernContinue(inbound) && !looksLikeNewConcern(inbound))) {
      const {
        processPhase9PersonalizedRecommendationTurn,
      } = require('./careerCounsellingV2PersonalizedRecommendationEngine');
      const readyCtx = {
        ...ctx,
        profile: persistReadiness({ ...(ctx.profile || {}) }),
      };
      return processPhase9PersonalizedRecommendationTurn(inbound, readyCtx, {
        startPhase9PersonalizedRecommendation: true,
        analytics: analyticsMeta,
      });
    }
    if (isConcernPermissionNo(inbound)) {
      const declineCount = Number(ctx.profile?._concernDeclineCount || 0) + 1;
      if (declineCount >= 2) {
        const {
          processPhase9PersonalizedRecommendationTurn,
        } = require('./careerCounsellingV2PersonalizedRecommendationEngine');
        const readyCtx = {
          ...ctx,
          profile: persistReadiness({
            ...(ctx.profile || {}),
            skippedPhaseReason: 'user_declined_optional_gate',
          }),
        };
        const advanced = await processPhase9PersonalizedRecommendationTurn(inbound, readyCtx, {
          startPhase9PersonalizedRecommendation: true,
          analytics: analyticsMeta,
        });
        return {
          ...advanced,
          skippedPhaseReason: 'user_declined_optional_gate',
          reply: `Understood — I’ll share a clear recommendation next.\n\n${advanced.reply || ''}`.trim(),
        };
      }
      return {
        reply: buildPickReply(ctx.profile || {}),
        context: {
          ...ctx,
          step: 'concern_pick',
          lastQuestionKey: 'concern_pick',
          profile: {
            ...(ctx.profile || {}),
            _concernDeclineCount: declineCount,
          },
        },
        clearState: false,
        parked: true,
        analytics: [],
      };
    }
    if (looksLikeNewConcern(inbound) || parseConcernPick(inbound, ctx.profile?.activeConcerns || [])) {
      const parsed = parseConcernPick(inbound, ctx.profile?.activeConcerns || []);
      if (parsed) {
        return respondToConcern(ctx, parsed.category, parsed.rawAnswer, analyticsMeta);
      }
    }
    return {
      reply: getConcernMessage('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startConcernResolution(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  CONCERN_RESOLUTION_STEPS,
  startConcernResolution,
  processConcernResolutionTurn,
};
