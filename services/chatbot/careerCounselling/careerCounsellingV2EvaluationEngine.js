'use strict';

const {
  STAGES,
  EVALUATION_STEPS,
  EVALUATION_QA,
  getEvalMessage,
  getNextEvalStep,
  getEvalContentForStep,
  buildPersonalizedTransition,
} = require('../../../constants/careerCounsellingV2Evaluation');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const {
  isSkipResponse,
  isSocialGreetingOnly,
} = require('./careerCounsellingV2ResponseParser');
const {
  parseEvaluationPriorities,
  isEvaluationAcknowledgment,
  isEvaluationQuestion,
  isKnowledgeConfirmYes,
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
const { startModernEducation } = require('./careerCounsellingV2ModernEducationEngine');

const TEACHING_STEPS = Object.freeze([
  'eval_transition',
  'eval_common_mistakes',
  'eval_framework',
  'eval_comparison',
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
    step: 'eval_transition',
    profile,
    lastQuestionKey: 'eval_transition',
    evaluationStartedAt: new Date().toISOString(),
  };

  logEvaluationStarted({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_transition',
    profileCompletionPct: profile.profileCompletionPct ?? null,
    ...analyticsMeta,
  });

  logEvaluationTopicViewed({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_transition',
    topic: 'personalized_transition',
    ...analyticsMeta,
  });

  return {
    reply: buildPersonalizedTransition(profile),
    context: nextCtx,
    clearState: false,
    analytics: [{ type: 'evaluation_started' }],
  };
}

function deliverStep(step, ctx, analyticsMeta = {}, prefix = '') {
  const content = getEvalContentForStep(step);
  const reply = prefix ? `${prefix}\n\n${content}` : content;

  logEvaluationTopicViewed({
    stage: ctx.stage,
    step,
    topic: step.replace(/^eval_/, ''),
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      step,
      lastQuestionKey: step.replace(/^eval_/, ''),
    },
    clearState: false,
    analytics: [{ type: 'evaluation_topic_viewed', step }],
  };
}

function advanceTeaching(ctx, analyticsMeta = {}) {
  const nextStep = getNextEvalStep(ctx.step);
  if (!nextStep) {
    return deliverStep('eval_ask_priorities', ctx, analyticsMeta);
  }
  return deliverStep(nextStep, { ...ctx, step: nextStep }, analyticsMeta);
}

function completeEvaluationAndOfferPermission(ctx, profile, analyticsMeta = {}) {
  const completedProfile = {
    ...profile,
    evaluationCompleted: true,
    mindsetShiftCompleted: true,
  };

  logMindsetShiftCompleted({
    stage: STAGES.EVALUATION_FRAMEWORK,
    step: 'eval_knowledge_confirm',
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
    reply: `${getEvalMessage('mindset_shift_ack')}\n\n${getEvalMessage('ask_permission')}`,
    context: {
      ...ctx,
      step: 'eval_ask_permission',
      profile: completedProfile,
      lastQuestionKey: 'permission',
      evaluationCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'mindset_shift_completed' },
      { type: 'evaluation_completed' },
    ],
  };
}

function transitionToModernEducation(ctx, analyticsMeta = {}) {
  return startModernEducation(ctx, analyticsMeta);
}

function handleTeachingStep(inbound, ctx, analyticsMeta) {
  if (isEvaluationQuestion(inbound)) {
    const answer = answerEvaluationQuestion(inbound);
    const resume = getEvalContentForStep(ctx.step);
    return {
      reply: `${answer}\n\n${getEvalMessage('resume_checkpoint_prefix')}\n${resume}`,
      context: ctx,
      clearState: false,
      analytics: [{ type: 'evaluation_question', step: ctx.step }],
    };
  }

  if (isEvaluationAcknowledgment(inbound) || isSkipResponse(inbound)) {
    return advanceTeaching(ctx, analyticsMeta);
  }

  // Soft advance on substantive engagement (student sharing related thoughts)
  if (inbound.length >= 12) {
    return advanceTeaching(ctx, analyticsMeta);
  }

  return {
    reply: getEvalMessage('awaiting_ack_nudge'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

function handlePrioritiesStep(inbound, ctx, analyticsMeta) {
  if (isEvaluationQuestion(inbound)) {
    const answer = answerEvaluationQuestion(inbound);
    return {
      reply: `${answer}\n\n${getEvalMessage('ask_priorities')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  const parsed = parseEvaluationPriorities(inbound);
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

  return {
    reply: `${getEvalMessage('priorities_ack')}\n\n${getEvalMessage('knowledge_confirm')}`,
    context: {
      ...ctx,
      step: 'eval_knowledge_confirm',
      profile,
      lastQuestionKey: 'knowledge_confirm',
    },
    clearState: false,
    analytics: [{ type: 'evaluation_priority_selected' }],
  };
}

function handleKnowledgeConfirm(inbound, ctx, analyticsMeta) {
  if (isEvaluationQuestion(inbound)) {
    const answer = answerEvaluationQuestion(inbound);
    return {
      reply: `${answer}\n\n${getEvalMessage('knowledge_confirm')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isKnowledgeConfirmYes(inbound) || isEvaluationAcknowledgment(inbound)) {
    return completeEvaluationAndOfferPermission(ctx, ctx.profile, analyticsMeta);
  }

  // Student still unclear — reinforce framework briefly then re-ask
  if (inbound.length >= 3) {
    return {
      reply: `${getEvalMessage('question_fallback')}\n\n${getEvalMessage('knowledge_confirm')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return {
    reply: getEvalMessage('knowledge_confirm'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

function handlePermission(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound)) {
    return transitionToModernEducation(ctx, analyticsMeta);
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
      analytics: [{ type: 'evaluation_permission_declined' }],
    };
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

function handlePermissionDeclined(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound)) {
    return {
      reply: getEvalMessage('ask_permission'),
      context: {
        ...ctx,
        step: 'eval_ask_permission',
        lastQuestionKey: 'permission',
      },
      clearState: false,
      analytics: [],
    };
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

  // Bootstrap: discovery just completed or legacy placeholder step
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
      analytics: [],
    };
  }

  if (TEACHING_STEPS.includes(ctx.step)) {
    return handleTeachingStep(inbound, ctx, analyticsMeta);
  }

  switch (ctx.step) {
    case 'eval_ask_priorities':
      return handlePrioritiesStep(inbound, ctx, analyticsMeta);
    case 'eval_knowledge_confirm':
      return handleKnowledgeConfirm(inbound, ctx, analyticsMeta);
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
};
