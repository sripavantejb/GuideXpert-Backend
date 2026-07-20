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
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
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
    educationalContent: true,
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
  const parsedEarly = parseEvaluationPriorities(inbound);
  if (isEvaluationQuestion(inbound) && !parsedEarly) {
    const answer = answerEvaluationQuestion(inbound);
    return {
      reply: `${answer}\n\n${getEvalMessage('ask_priorities')}`,
      context: ctx,
      clearState: false,
      skipLineCap: true,
      analytics: [],
    };
  }

  const parsed = parsedEarly || parseEvaluationPriorities(inbound);
  if (!parsed) {
    return {
      reply: getEvalMessage('priorities_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  const profile = patchProfile(ctx.profile, {
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

  return completeFrameworkAndOfferPermission(ctx, profile, analyticsMeta);
}

async function handlePermission(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound)) {
    return transitionToExploreModernColleges(ctx, analyticsMeta);
  }

  if (isPermissionNo(inbound)) {
    return {
      reply: getEvalMessage('permission_no'),
      context: {
        ...ctx,
        step: 'eval_permission_declined',
        lastQuestionKey: 'permission_declined',
      },
      clearState: false,
      parked: true,
      analytics: [{ type: 'evaluation_permission_declined' }],
    };
  }

  const refined = parseEvaluationPriorities(inbound);
  if (refined && !isEvaluationAcknowledgment(inbound)) {
    const profile = patchProfile(ctx.profile, {
      evaluationPriorities: refined.evaluationPriorities,
      studentPriorities: refined.studentPriorities,
      evaluationConfidence: refined.evaluationConfidence,
      suggestedByCounselor: Boolean(refined.suggestedByCounselor),
      _rawAnswer: refined.rawAnswer,
      _questionKey: 'evaluation_priorities',
    });
    return completeFrameworkAndOfferPermission(ctx, profile, analyticsMeta);
  }

  if (isEvaluationQuestion(inbound)) {
    const answer = answerEvaluationQuestion(inbound);
    return {
      reply: `${answer}\n\n${getEvalMessage('permission_clarify')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return {
    reply: getEvalMessage('permission_clarify'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

async function handlePermissionDeclined(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound) || isEvaluationAcknowledgment(inbound)) {
    return transitionToExploreModernColleges(
      { ...ctx, step: 'eval_ask_permission' },
      analyticsMeta
    );
  }
  const refined = parseEvaluationPriorities(inbound);
  if (refined) {
    const profile = patchProfile(ctx.profile, {
      evaluationPriorities: refined.evaluationPriorities,
      studentPriorities: refined.studentPriorities,
      evaluationConfidence: refined.evaluationConfidence,
      suggestedByCounselor: Boolean(refined.suggestedByCounselor),
      _rawAnswer: refined.rawAnswer,
      _questionKey: 'evaluation_priorities',
    });
    return completeFrameworkAndOfferPermission(ctx, profile, analyticsMeta);
  }
  return {
    reply: getEvalMessage('permission_declined_reengage'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

async function processEvaluationTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startEvaluation ||
    ctx.step === 'evaluation_framework_placeholder' ||
    (ctx.stage === STAGES.EVALUATION_FRAMEWORK &&
      !EVALUATION_STEPS.includes(ctx.step) &&
      ctx.step !== 'eval_permission_declined')
  ) {
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
    case 'eval_permission_declined':
      return handlePermissionDeclined(inbound, ctx, analyticsMeta);
    default:
      return startEvaluation(ctx, analyticsMeta);
  }
}

module.exports = {
  STAGES,
  EVALUATION_STEPS,
  startEvaluation,
  processEvaluationTurn,
  buildFrameworkExpandMessage,
};
