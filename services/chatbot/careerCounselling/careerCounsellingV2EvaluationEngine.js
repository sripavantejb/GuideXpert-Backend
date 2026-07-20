'use strict';

/**
 * Interactive Stage 3 — Discover priorities → validate + expand → permission → Explore.
 * Legacy multi-teaching lecture chain is bypassed (redirected to priorities ask).
 */

const {
  STAGES,
  EVALUATION_STEPS,
  EVALUATION_QA,
  getEvalMessage,
  getEvalContentForStep,
  buildFrameworkExpandMessage,
} = require('../../../constants/careerCounsellingV2Evaluation');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly, isUnclearCounselingInput } = require('./careerCounsellingV2ResponseParser');
const {
  parseEvaluationPriorities,
  isEvaluationAcknowledgment,
  isEvaluationQuestion,
  isPermissionYes,
  isPermissionNo,
} = require('./careerCounsellingV2EvaluationParser');
const {
  logEvaluationStarted,
  logEvaluationTopicViewed,
  logEvaluationPrioritySelected,
  logEvaluationCompleted,
  logMindsetShiftCompleted,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

const LEGACY_TEACHING_STEPS = Object.freeze([
  'eval_transition',
  'eval_common_mistakes',
  'eval_framework',
  'eval_comparison',
  'eval_knowledge_confirm',
]);

function isWaitingForEvaluationPriorities(ctx = {}) {
  return (
    ctx.step === 'eval_ask_priorities' || ctx.lastQuestionKey === 'evaluation_priorities'
  );
}

function isWaitingForEvaluationPermission(ctx = {}) {
  return (
    ctx.step === 'eval_ask_permission' ||
    ctx.step === 'eval_offer_personalization' ||
    ctx.step === 'eval_permission_declined' ||
    ctx.lastQuestionKey === 'permission' ||
    ctx.lastQuestionKey === 'personalization_offer'
  );
}

function normalizeEvaluationContext(ctx = {}) {
  return {
    ...ctx,
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: ctx.step === 'eval_ask_permission' ? 'eval_ask_permission' : 'eval_ask_priorities',
  };
}

function shouldRestartEvaluation(ctx = {}, opts = {}) {
  return (
    Boolean(opts.startEvaluation) ||
    ctx.step === 'evaluation_framework_placeholder' ||
    (ctx.stage === STAGES.EVALUATION_FRAMEWORK &&
      !EVALUATION_STEPS.includes(ctx.step) &&
      ctx.step !== 'eval_permission_declined')
  );
}

function withUnclearStreak(ctx, streak) {
  return {
    ...ctx,
    profile: {
      ...(ctx.profile || {}),
      unclearInputStreak: streak,
    },
  };
}

function bumpUnclearStreak(ctx) {
  const streak = Number(ctx.profile?.unclearInputStreak || 0) + 1;
  return withUnclearStreak(ctx, streak);
}

function resetUnclearStreak(ctx) {
  if (!ctx.profile?.unclearInputStreak) return ctx;
  return withUnclearStreak(ctx, 0);
}

function buildUnclearClarifyReply(ctx, baseKey) {
  const base = getEvalMessage(baseKey);
  const streak = Number(ctx.profile?.unclearInputStreak || 0);
  if (streak >= 3) {
    return `${base}\n\n${getEvalMessage('repeated_unclear_menu_offer')}`;
  }
  return base;
}

function unclearInputResponse(ctx, baseKey, analyticsMeta = {}) {
  const nextCtx = bumpUnclearStreak(ctx);
  return {
    reply: buildUnclearClarifyReply(nextCtx, baseKey),
    context: nextCtx,
    clearState: false,
    skipLineCap: true,
    keepIntact: true,
    allowSkipAdvance: true,
    analytics: [{ type: 'evaluation_unclear_input', streak: nextCtx.profile.unclearInputStreak }],
  };
}

function answerEvaluationQuestion(text) {
  const t = String(text || '').trim();
  for (const entry of EVALUATION_QA) {
    if (entry.patterns.some((re) => re.test(t))) {
      return entry.answer;
    }
  }
  return getEvalMessage('question_fallback');
}

function appendConversationContext(profile, entry) {
  const ctx = Array.isArray(profile.conversationContext) ? [...profile.conversationContext] : [];
  ctx.push({ ...entry, at: new Date().toISOString() });
  return ctx.slice(-20);
}

function patchProfile(profile, fields) {
  const next = { ...profile, ...fields };
  if (fields._rawAnswer) {
    next.conversationContext = appendConversationContext(next, {
      questionKey: fields._questionKey || 'evaluation',
      answer: String(fields._rawAnswer).slice(0, 500),
    });
    delete next._rawAnswer;
    delete next._questionKey;
  }
  return next;
}

function startEvaluation(ctx, analyticsMeta = {}) {
  const profile = {
    ...(ctx.profile || {}),
    evaluationPriorities: Array.isArray(ctx.profile?.evaluationPriorities)
      ? ctx.profile.evaluationPriorities
      : [],
    studentPriorities: Array.isArray(ctx.profile?.studentPriorities)
      ? ctx.profile.studentPriorities
      : [],
    evaluationCompleted: false,
    mindsetShiftCompleted: false,
    evaluationConfidence: ctx.profile?.evaluationConfidence || null,
  };

  const nextCtx = {
    ...ctx,
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_priorities',
    profile,
    lastQuestionKey: 'evaluation_priorities',
    evaluationStartedAt: new Date().toISOString(),
  };

  logEvaluationStarted({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_priorities',
    profileCompletionPct: profile.profileCompletionPct ?? null,
    ...analyticsMeta,
  });

  logEvaluationTopicViewed({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_priorities',
    topic: 'discover_priorities',
    ...analyticsMeta,
  });

  return {
    reply: getEvalMessage('ask_priorities'),
    context: nextCtx,
    clearState: false,
    skipLineCap: true,
    analytics: [{ type: 'evaluation_started' }],
  };
}

function completeFrameworkAndOfferPermission(ctx, profile, analyticsMeta = {}) {
  const completedProfile = {
    ...profile,
    evaluationCompleted: true,
    mindsetShiftCompleted: true,
    modernEducationCompleted: true,
    learningStyle: profile.learningStyle || profile.preferredLearningStyle || 'exploring',
    preferredLearningStyle:
      profile.preferredLearningStyle || profile.learningStyle || 'exploring',
  };

  logMindsetShiftCompleted({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_permission',
    evaluationPriorities: completedProfile.evaluationPriorities,
    ...analyticsMeta,
  });

  logEvaluationCompleted({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_permission',
    evaluationPriorities: completedProfile.evaluationPriorities,
    evaluationConfidence: completedProfile.evaluationConfidence,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_permission',
    fieldsUpdated: [
      'evaluationPriorities',
      'studentPriorities',
      'evaluationCompleted',
      'mindsetShiftCompleted',
      'evaluationConfidence',
    ],
    ...analyticsMeta,
  });

  return {
    reply: buildFrameworkExpandMessage(completedProfile),
    context: {
      ...ctx,
      step: 'eval_ask_permission',
      profile: completedProfile,
      lastQuestionKey: 'permission',
      evaluationCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    skipLineCap: true,
    keepIntact: true,
    educationalContent: true,
    allowSkipAdvance: true,
    analytics: [
      { type: 'mindset_shift_completed' },
      { type: 'evaluation_completed' },
      { type: 'interactive_framework_presented' },
    ],
  };
}

async function transitionToExploreModernColleges(ctx, analyticsMeta = {}) {
  const {
    processExploreModernCollegesTurn,
  } = require('./careerCounsellingV2ExploreModernCollegesEngine');
  return processExploreModernCollegesTurn('yes', ctx, {
    startExploreModernColleges: true,
    fromEvaluation: true,
    presentImmediately: true,
    analytics: analyticsMeta,
  });
}

function handlePrioritiesStep(inbound, ctx, analyticsMeta) {
  if (isEvaluationAcknowledgment(inbound)) {
    return unclearInputResponse(ctx, 'confusion_clarify_priorities', analyticsMeta);
  }

  if (isUnclearCounselingInput(inbound)) {
    return unclearInputResponse(ctx, 'confusion_clarify_priorities', analyticsMeta);
  }

  if (isEvaluationQuestion(inbound)) {
    const answer = answerEvaluationQuestion(inbound);
    const nextCtx = resetUnclearStreak(ctx);
    return {
      reply: `${answer}\n\n${getEvalMessage('ask_priorities')}`,
      context: nextCtx,
      clearState: false,
      skipLineCap: true,
      analytics: [],
    };
  }

  const parsed = parseEvaluationPriorities(inbound);
  if (!parsed) {
    return unclearInputResponse(ctx, 'confusion_clarify_priorities', analyticsMeta);
  }

  const profile = patchProfile(resetUnclearStreak(ctx).profile, {
    evaluationPriorities: parsed.evaluationPriorities,
    studentPriorities: parsed.studentPriorities,
    evaluationConfidence: parsed.evaluationConfidence,
    suggestedByCounselor: Boolean(parsed.suggestedByCounselor),
    _rawAnswer: parsed.rawAnswer,
    _questionKey: 'evaluation_priorities',
  });

  logEvaluationPrioritySelected({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_priorities',
    evaluationPriorities: parsed.evaluationPriorities,
    studentPriorities: parsed.studentPriorities,
    evaluationConfidence: parsed.evaluationConfidence,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_ask_priorities',
    fieldsUpdated: ['evaluationPriorities', 'studentPriorities', 'evaluationConfidence'],
    ...analyticsMeta,
  });

  return completeFrameworkAndOfferPermission(resetUnclearStreak(ctx), profile, analyticsMeta);
}

async function handlePermission(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound)) {
    return transitionToExploreModernColleges(resetUnclearStreak(ctx), analyticsMeta);
  }

  if (isPermissionNo(inbound)) {
    return {
      reply: getEvalMessage('permission_no'),
      context: resetUnclearStreak({
        ...ctx,
        step: 'eval_offer_personalization',
        lastQuestionKey: 'personalization_offer',
      }),
      clearState: false,
      keepIntact: true,
      allowSkipAdvance: true,
      skipLineCap: true,
      analytics: [{ type: 'evaluation_permission_declined' }],
    };
  }

  if (isUnclearCounselingInput(inbound)) {
    return unclearInputResponse(ctx, 'confusion_clarify_permission', analyticsMeta);
  }

  const refined = parseEvaluationPriorities(inbound);
  if (
    refined &&
    !isEvaluationAcknowledgment(inbound) &&
    !/^\d+$/.test(String(inbound || '').trim())
  ) {
    const profile = patchProfile(ctx.profile, {
      evaluationPriorities: refined.evaluationPriorities,
      studentPriorities: refined.studentPriorities,
      evaluationConfidence: refined.evaluationConfidence,
      suggestedByCounselor: Boolean(refined.suggestedByCounselor),
      _rawAnswer: refined.rawAnswer,
      _questionKey: 'evaluation_priorities',
    });
    return completeFrameworkAndOfferPermission(resetUnclearStreak(ctx), profile, analyticsMeta);
  }

  if (isEvaluationQuestion(inbound)) {
    const answer = answerEvaluationQuestion(inbound);
    const nextCtx = resetUnclearStreak(ctx);
    return {
      reply: `${answer}\n\n${getEvalMessage('permission_clarify')}`,
      context: nextCtx,
      clearState: false,
      analytics: [],
    };
  }

  return unclearInputResponse(ctx, 'confusion_clarify_permission', analyticsMeta);
}

async function transitionToPersonalization(ctx, analyticsMeta = {}, prefix = '') {
  const {
    startPersonalizedDiscovery,
  } = require('./careerCounsellingV2PersonalizationEngine');
  const started = startPersonalizedDiscovery(ctx, analyticsMeta);
  if (!prefix) return started;
  return {
    ...started,
    reply: `${prefix}\n\n${started.reply}`,
    keepIntact: true,
    allowSkipAdvance: true,
  };
}

async function handleOfferPersonalization(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound) || isEvaluationAcknowledgment(inbound)) {
    return transitionToPersonalization(ctx, analyticsMeta);
  }
  if (isPermissionNo(inbound)) {
    return {
      reply: getEvalMessage('permission_declined_reengage'),
      context: resetUnclearStreak(ctx),
      clearState: false,
      keepIntact: true,
      allowSkipAdvance: true,
      analytics: [],
    };
  }
  if (isUnclearCounselingInput(inbound)) {
    return unclearInputResponse(ctx, 'confusion_clarify_personalization', analyticsMeta);
  }
  const refined = parseEvaluationPriorities(inbound);
  if (refined) {
    const profile = patchProfile(resetUnclearStreak(ctx).profile, {
      evaluationPriorities: refined.evaluationPriorities,
      studentPriorities: refined.studentPriorities,
      evaluationConfidence: refined.evaluationConfidence,
      suggestedByCounselor: Boolean(refined.suggestedByCounselor),
      _rawAnswer: refined.rawAnswer,
      _questionKey: 'evaluation_priorities',
    });
    return completeFrameworkAndOfferPermission(resetUnclearStreak(ctx), profile, analyticsMeta);
  }
  return unclearInputResponse(ctx, 'confusion_clarify_personalization', analyticsMeta);
}

async function handlePermissionDeclined(inbound, ctx, analyticsMeta) {
  // Legacy parked step — route into personalization offer continuity.
  return handleOfferPersonalization(inbound, {
    ...ctx,
    step: 'eval_offer_personalization',
    lastQuestionKey: 'personalization_offer',
  }, analyticsMeta);
}

async function processEvaluationTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (shouldRestartEvaluation(ctx, opts)) {
    const parsed = parseEvaluationPriorities(inbound);
    if (
      parsed &&
      (isWaitingForEvaluationPriorities(ctx) ||
        ctx.stage === STAGES.EVALUATION_FRAMEWORK ||
        ctx.lastQuestionKey === 'evaluation_priorities')
    ) {
      return handlePrioritiesStep(inbound, normalizeEvaluationContext(ctx), analyticsMeta);
    }
    return startEvaluation(ctx, analyticsMeta);
  }

  if (
    ctx.stage === STAGES.MODERN_COLLEGES ||
    ctx.stage === STAGES.PERSONALIZED_DISCOVERY ||
    ctx.stage === 'explore_modern_colleges' ||
    ctx.stage === STAGES.PERSONALIZED_SHORTLISTING ||
    ctx.stage === STAGES.AI_SHORTLISTING ||
    ctx.stage === STAGES.SMART_COMPARISON ||
    ctx.stage === STAGES.CONCERN_RESOLUTION ||
    ctx.stage === STAGES.CONCERN_RESOLUTION_PLACEHOLDER ||
    ctx.stage === STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION ||
    ctx.stage === STAGES.PHASE_10_FUTURE_PATH_VISION ||
    ctx.stage === STAGES.PHASE_11_FINAL_DECISION_HESITATION ||
    ctx.stage === STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION ||
    ctx.stage === STAGES.PHASE_13_BOOKING_ORCHESTRATOR ||
    ctx.stage === STAGES.PHASE_13_BOOKING_PLACEHOLDER ||
    ctx.stage === STAGES.PHASE_14_JOURNEY_COMPLETION ||
    ctx.stage === STAGES.JOURNEY_COMPLETED ||
    ctx.stage === STAGES.COUNSELING_INVITATION ||
    ctx.stage === STAGES.COUNSELING_INVITATION_PLACEHOLDER ||
    ctx.stage === STAGES.CONVERSATION_COMPLETE ||
    ctx.stage === STAGES.COMPARISON_PLACEHOLDER ||
    ctx.step === 'modern_colleges_placeholder' ||
    ctx.step === 'personalized_shortlisting_placeholder' ||
    ctx.step === 'ai_shortlisting_placeholder' ||
    ctx.step === 'comparison_placeholder' ||
    ctx.step === 'concern_resolution_placeholder' ||
    ctx.step === 'phase9_personalized_recommendation_placeholder' ||
    ctx.step === 'phase10_future_path_vision_placeholder' ||
    ctx.step === 'phase11_final_decision_hesitation_placeholder' ||
    ctx.step === 'phase12_personalized_counseling_recommendation_placeholder' ||
    ctx.step === 'phase13_booking_placeholder' ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    ctx.step === 'journey_completed' ||
    ctx.step === 'counseling_invitation_placeholder' ||
    ctx.step === 'conversation_complete' ||
    (typeof ctx.step === 'string' &&
      (ctx.step.startsWith('modern_') ||
        ctx.step.startsWith('pers_') ||
        ctx.step.startsWith('explore_') ||
        ctx.step.startsWith('shortlist_') ||
        ctx.step.startsWith('compare_') ||
        ctx.step.startsWith('concern_') ||
        ctx.step.startsWith('phase9_') ||
        ctx.step.startsWith('vision_') ||
        ctx.step.startsWith('hesitation_') ||
        ctx.step.startsWith('counsel_rec_') ||
        ctx.step.startsWith('booking_') ||
        ctx.step.startsWith('invite_')))
  ) {
    if (
      ctx.stage === 'explore_modern_colleges' ||
      (typeof ctx.step === 'string' && ctx.step.startsWith('explore_'))
    ) {
      const {
        processExploreModernCollegesTurn,
      } = require('./careerCounsellingV2ExploreModernCollegesEngine');
      return processExploreModernCollegesTurn(inbound, ctx, {
        analytics: analyticsMeta,
      });
    }
    if (
      ctx.stage === STAGES.PERSONALIZED_DISCOVERY ||
      (typeof ctx.step === 'string' && ctx.step.startsWith('pers_'))
    ) {
      const {
        processPersonalizedDiscoveryTurn,
      } = require('./careerCounsellingV2PersonalizationEngine');
      return processPersonalizedDiscoveryTurn(inbound, ctx, {
        analytics: analyticsMeta,
      });
    }
    // Legacy modern stage — soft-skip into explore (interactive framework)
    if (
      ctx.stage === STAGES.MODERN_COLLEGES ||
      (typeof ctx.step === 'string' && ctx.step.startsWith('modern_'))
    ) {
      return transitionToExploreModernColleges(
        {
          ...ctx,
          profile: {
            ...(ctx.profile || {}),
            modernEducationCompleted: true,
            learningStyle: ctx.profile?.learningStyle || 'exploring',
          },
        },
        analyticsMeta
      );
    }
    const {
      processModernEducationTurn,
    } = require('./careerCounsellingV2ModernEducationEngine');
    return processModernEducationTurn(inbound, ctx, {
      startModernEducation: ctx.step === 'modern_colleges_placeholder',
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
    const content = getEvalContentForStep(ctx.step) || getEvalMessage('awaiting_ack_nudge');
    return {
      reply: `${getEvalMessage('greeting_mid_evaluation')}\n\n${content}`,
      context: ctx,
      clearState: false,
      skipLineCap: true,
      analytics: [],
    };
  }

  // Legacy lecture resume → interactive priorities
  if (LEGACY_TEACHING_STEPS.includes(ctx.step)) {
    return startEvaluation(ctx, analyticsMeta);
  }

  switch (ctx.step) {
    case 'eval_ask_priorities':
      return handlePrioritiesStep(inbound, ctx, analyticsMeta);
    case 'eval_ask_permission':
      return handlePermission(inbound, ctx, analyticsMeta);
    case 'eval_offer_personalization':
      return handleOfferPersonalization(inbound, ctx, analyticsMeta);
    case 'eval_permission_declined':
      return handlePermissionDeclined(inbound, ctx, analyticsMeta);
    default:
      return startEvaluation(ctx, analyticsMeta);
  }
}

module.exports = {
  STAGES,
  EVALUATION_STEPS,
  isWaitingForEvaluationPriorities,
  isWaitingForEvaluationPermission,
  startEvaluation,
  processEvaluationTurn,
  buildFrameworkExpandMessage,
};
