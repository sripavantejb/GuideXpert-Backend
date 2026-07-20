'use strict';

const {
  STAGES,
  MODERN_EDUCATION_STEPS,
  MODERN_EDUCATION_QA,
  getModernMessage,
  getNextModernStep,
  getModernContentForStep,
  buildPersonalizedModernTransition,
} = require('../../../constants/careerCounsellingV2ModernEducation');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const {
  isSkipResponse,
  isSocialGreetingOnly,
} = require('./careerCounsellingV2ResponseParser');
const {
  parseLearningPreferences,
  isModernAcknowledgment,
  isModernQuestion,
  isPermissionYes,
  isPermissionNo,
} = require('./careerCounsellingV2ModernEducationParser');
const {
  logModernEducationStarted,
  logLearningPreferenceSelected,
  logLearningStyleIdentified,
  logModernEducationCompleted,
  logModernTopicViewed,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');
const { startPersonalizedDiscovery } = require('./careerCounsellingV2PersonalizationEngine');

const TEACHING_STEPS = Object.freeze([
  'modern_transition',
  'modern_what_is',
  'modern_traditional_vs',
  'modern_industry_learning',
  'modern_student_story',
]);

function answerModernQuestion(text) {
  const t = String(text || '').trim();
  for (const entry of MODERN_EDUCATION_QA) {
    if (entry.patterns.some((re) => re.test(t))) {
      return entry.answer;
    }
  }
  return getModernMessage('question_fallback');
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
      questionKey: fields._questionKey || 'modern_education',
      answer: String(fields._rawAnswer).slice(0, 500),
    });
    delete next._rawAnswer;
    delete next._questionKey;
  }
  return next;
}

function ensureModernProfileFields(profile = {}) {
  return {
    ...profile,
    learningPreferences: Array.isArray(profile.learningPreferences) ? profile.learningPreferences : [],
    preferredLearningStyle: profile.preferredLearningStyle ?? null,
    futureSkillInterest: profile.futureSkillInterest ?? false,
    industryExposureInterest: profile.industryExposureInterest ?? false,
    projectInterest: profile.projectInterest ?? false,
    portfolioInterest: profile.portfolioInterest ?? false,
    internshipInterest: profile.internshipInterest ?? false,
    modernEducationCompleted: Boolean(profile.modernEducationCompleted),
  };
}

function startModernEducation(ctx, analyticsMeta = {}) {
  const profile = ensureModernProfileFields(ctx.profile);

  const nextCtx = {
    ...ctx,
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_transition',
    profile,
    lastQuestionKey: 'modern_transition',
    modernEducationStartedAt: new Date().toISOString(),
  };

  logModernEducationStarted({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_transition',
    profileCompletionPct: profile.profileCompletionPct ?? null,
    ...analyticsMeta,
  });

  logModernTopicViewed({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_transition',
    topic: 'personalized_transition',
    ...analyticsMeta,
  });

  return {
    reply: buildPersonalizedModernTransition(profile),
    context: nextCtx,
    clearState: false,
    educationalContent: true,
    analytics: [{ type: 'modern_education_started' }],
  };
}

function deliverStep(step, ctx, analyticsMeta = {}, prefix = '') {
  const content = getModernContentForStep(step);
  const reply = prefix ? `${prefix}\n\n${content}` : content;

  logModernTopicViewed({
    stage: ctx.stage,
    step,
    topic: step.replace(/^modern_/, ''),
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      step,
      lastQuestionKey: step.replace(/^modern_/, ''),
    },
    clearState: false,
    educationalContent: true,
    analytics: [{ type: 'modern_topic_viewed', step }],
  };
}

function advanceTeaching(ctx, analyticsMeta = {}) {
  const nextStep = getNextModernStep(ctx.step);
  if (!nextStep) {
    return deliverStep('modern_ask_learning_style', ctx, analyticsMeta);
  }
  return deliverStep(nextStep, { ...ctx, step: nextStep }, analyticsMeta);
}

function completeModernAndOfferPermission(ctx, profile, analyticsMeta = {}) {
  const completedProfile = {
    ...profile,
    modernEducationCompleted: true,
  };

  logModernEducationCompleted({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_ask_permission',
    preferredLearningStyle: completedProfile.preferredLearningStyle,
    learningPreferences: completedProfile.learningPreferences,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_ask_permission',
    fieldsUpdated: [
      'learningPreferences',
      'preferredLearningStyle',
      'futureSkillInterest',
      'industryExposureInterest',
      'projectInterest',
      'portfolioInterest',
      'internshipInterest',
      'modernEducationCompleted',
    ],
    ...analyticsMeta,
  });

  return {
    reply: `${getModernMessage('modern_complete_ack')}\n\n${getModernMessage('knowledge_summary')}\n\n${getModernMessage('ask_permission')}`,
    context: {
      ...ctx,
      step: 'modern_ask_permission',
      profile: completedProfile,
      lastQuestionKey: 'permission',
      modernEducationCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    educationalContent: true,
    analytics: [{ type: 'modern_education_completed' }],
  };
}

function transitionToPersonalizedDiscovery(ctx, analyticsMeta = {}) {
  return startPersonalizedDiscovery(ctx, analyticsMeta);
}

function handleTeachingStep(inbound, ctx, analyticsMeta) {
  if (isModernQuestion(inbound)) {
    const answer = answerModernQuestion(inbound);
    const resume = getModernContentForStep(ctx.step);
    return {
      reply: `${answer}\n\n${getModernMessage('resume_checkpoint_prefix')}\n${resume}`,
      context: ctx,
      clearState: false,
      analytics: [{ type: 'modern_question', step: ctx.step }],
    };
  }

  if (isModernAcknowledgment(inbound) || isSkipResponse(inbound)) {
    return advanceTeaching(ctx, analyticsMeta);
  }

  if (inbound.length >= 12) {
    return advanceTeaching(ctx, analyticsMeta);
  }

  return {
    reply: getModernMessage('awaiting_ack_nudge'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

function handleLearningStyleStep(inbound, ctx, analyticsMeta) {
  if (isModernQuestion(inbound)) {
    const answer = answerModernQuestion(inbound);
    return {
      reply: `${answer}\n\n${getModernMessage('ask_learning_style')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  const parsed = parseLearningPreferences(inbound);
  if (!parsed) {
    return {
      reply: getModernMessage('learning_style_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  const profile = patchProfile(ctx.profile, {
    learningPreferences: parsed.learningPreferences,
    preferredLearningStyle: parsed.preferredLearningStyle,
    futureSkillInterest: parsed.futureSkillInterest,
    industryExposureInterest: parsed.industryExposureInterest,
    projectInterest: parsed.projectInterest,
    portfolioInterest: parsed.portfolioInterest,
    internshipInterest: parsed.internshipInterest,
    _rawAnswer: parsed.rawAnswer,
    _questionKey: 'learning_preferences',
  });

  logLearningPreferenceSelected({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_ask_learning_style',
    learningPreferences: parsed.learningPreferences,
    preferredLearningStyle: parsed.preferredLearningStyle,
    ...analyticsMeta,
  });

  logLearningStyleIdentified({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_ask_learning_style',
    preferredLearningStyle: parsed.preferredLearningStyle,
    projectInterest: parsed.projectInterest,
    internshipInterest: parsed.internshipInterest,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.MODERN_COLLEGES,
    step: 'modern_ask_learning_style',
    fieldsUpdated: [
      'learningPreferences',
      'preferredLearningStyle',
      'futureSkillInterest',
      'industryExposureInterest',
      'projectInterest',
      'portfolioInterest',
      'internshipInterest',
    ],
    ...analyticsMeta,
  });

  return completeModernAndOfferPermission(
    {
      ...ctx,
      step: 'modern_knowledge_summary',
      profile,
      lastQuestionKey: 'knowledge_summary',
    },
    profile,
    analyticsMeta
  );
}

function handlePermission(inbound, ctx, analyticsMeta) {
  if (isPermissionYes(inbound)) {
    return transitionToPersonalizedDiscovery(ctx, analyticsMeta);
  }

  if (isPermissionNo(inbound)) {
    return {
      reply: getModernMessage('permission_no'),
      context: {
        ...ctx,
        step: 'modern_permission_declined',
        lastQuestionKey: 'permission_declined',
      },
      clearState: false,
      analytics: [{ type: 'modern_permission_declined' }],
    };
  }

  if (isModernQuestion(inbound)) {
    const answer = answerModernQuestion(inbound);
    return {
      reply: `${answer}\n\n${getModernMessage('permission_clarify')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return {
    reply: getModernMessage('permission_clarify'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

function handlePermissionDeclined(inbound, ctx) {
  if (isPermissionYes(inbound)) {
    return {
      reply: getModernMessage('ask_permission'),
      context: {
        ...ctx,
        step: 'modern_ask_permission',
        lastQuestionKey: 'permission',
      },
      clearState: false,
      analytics: [],
    };
  }
  return {
    reply: getModernMessage('permission_declined_reengage'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

async function processModernEducationTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startModernEducation ||
    ctx.step === 'modern_colleges_placeholder' ||
    (ctx.stage === STAGES.MODERN_COLLEGES &&
      !MODERN_EDUCATION_STEPS.includes(ctx.step) &&
      ctx.step !== 'modern_permission_declined')
  ) {
    return startModernEducation(ctx, analyticsMeta);
  }

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
      (ctx.step.startsWith('shortlist_') ||
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
      processAiShortlistingTurn,
    } = require('./careerCounsellingV2ShortlistingEngine');
    return processAiShortlistingTurn(inbound, ctx, {
      startAiShortlisting: ctx.step === 'ai_shortlisting_placeholder',
      analytics: analyticsMeta,
    });
  }

  if (
    ctx.stage === STAGES.PERSONALIZED_DISCOVERY ||
    ctx.stage === STAGES.PERSONALIZED_SHORTLISTING ||
    ctx.step === 'personalized_shortlisting_placeholder' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('pers_'))
  ) {
    const {
      processPersonalizedDiscoveryTurn,
    } = require('./careerCounsellingV2PersonalizationEngine');
    return processPersonalizedDiscoveryTurn(inbound, ctx, {
      startPersonalizedDiscovery:
        ctx.step === 'personalized_shortlisting_placeholder' ||
        opts.startPersonalizedDiscovery,
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
    const content = getModernContentForStep(ctx.step) || getModernMessage('awaiting_ack_nudge');
    return {
      reply: `${getModernMessage('greeting_mid_modern')}\n\n${content}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (TEACHING_STEPS.includes(ctx.step)) {
    return handleTeachingStep(inbound, ctx, analyticsMeta);
  }

  switch (ctx.step) {
    case 'modern_ask_learning_style':
      return handleLearningStyleStep(inbound, ctx, analyticsMeta);
    case 'modern_knowledge_summary':
      return completeModernAndOfferPermission(ctx, ctx.profile, analyticsMeta);
    case 'modern_ask_permission':
      return handlePermission(inbound, ctx, analyticsMeta);
    case 'modern_permission_declined':
      return handlePermissionDeclined(inbound, ctx);
    default:
      return startModernEducation(ctx, analyticsMeta);
  }
}

module.exports = {
  STAGES,
  MODERN_EDUCATION_STEPS,
  startModernEducation,
  processModernEducationTurn,
};
