'use strict';

const {
  FLOW_ID,
  STAGES,
  DISCOVERY_STEPS,
  getMessage,
  getNextStep,
  getQuestionForStep,
  getClarifyForStep,
  getAckForStep,
} = require('../../../constants/careerCounsellingV2Discovery');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const {
  isSkipResponse,
  isCorrectionResponse,
  isSocialGreetingOnly,
  parseQualificationAnswer,
  parseCourseAnswer,
  parseCareerGoalAnswer,
  parseShortlistAnswer,
  parseLanguageAnswer,
  detectCorrectionField,
} = require('./careerCounsellingV2ResponseParser');
const {
  logDiscoveryStarted,
  logDiscoveryQuestionAnswered,
  logProfileUpdated,
  logDiscoveryCompleted,
} = require('./careerCounsellingV2Analytics');
const { startEvaluation, processEvaluationTurn } = require('./careerCounsellingV2EvaluationEngine');
const {
  STAGES: EVAL_STAGES,
} = require('../../../constants/careerCounsellingV2Evaluation');

function emptyProfile() {
  return {
    currentQualification: null,
    currentClass: null,
    preferredCourse: null,
    careerGoal: null,
    preferredColleges: [],
    preferredLanguage: null,
    conversationContext: [],
    profileCompletionPct: 0,
    evaluationPriorities: [],
    studentPriorities: [],
    evaluationCompleted: false,
    mindsetShiftCompleted: false,
    evaluationConfidence: null,
    learningPreferences: [],
    preferredLearningStyle: null,
    futureSkillInterest: false,
    industryExposureInterest: false,
    projectInterest: false,
    portfolioInterest: false,
    internshipInterest: false,
    modernEducationCompleted: false,
    careerPriority: null,
    preferredLocation: null,
    relocationPreference: null,
    hostelRequired: null,
    budgetPreference: null,
    financialPreference: null,
    parentPreferences: null,
    familyConstraints: [],
    biggestConcerns: [],
    recommendationConfidence: null,
    counselingConfidenceScore: null,
    recommendedColleges: [],
    recommendationReasons: {},
    recommendationMatrixVersion: null,
    exam: null,
    rank: null,
    category: null,
    gender: null,
    region: null,
    admissionCategory: null,
    reservationCategory: null,
    reservationCategoryCodes: [],
    comparedColleges: [],
    comparisonDimensions: [],
    comparisonSummary: null,
    preferredCollege: null,
    decisionConfidence: null,
    decisionReasons: [],
    comparisonEngineVersion: null,
    resolvedConcerns: [],
    activeConcerns: [],
    decisionReadiness: null,
    lastConcernCategory: null,
    objectionHistory: [],
    concernEngineVersion: null,
    counselingInvitationShown: false,
    counselingInvitationAccepted: false,
    counselingInvitationDeclined: false,
    counselingInvitationDeferred: false,
    handoffReason: null,
    invitationEngineVersion: null,
  };
}

function initialContext() {
  return {
    flow: FLOW_ID,
    version: 2,
    stage: STAGES.DISCOVERY,
    step: 'awaiting_qualification',
    profile: emptyProfile(),
    lastQuestionKey: 'qualification',
    discoveryStartedAt: null,
    discoveryCompletedAt: null,
  };
}

function appendConversationContext(profile, entry) {
  const ctx = Array.isArray(profile.conversationContext) ? [...profile.conversationContext] : [];
  ctx.push({
    ...entry,
    at: new Date().toISOString(),
  });
  return ctx.slice(-20);
}

function computeProfileCompletion(profile) {
  let filled = 0;
  const weights = [
    ['currentQualification', 15],
    ['currentClass', 10],
    ['preferredCourse', 20],
    ['careerGoal', 20],
    ['preferredColleges', 15],
    ['preferredLanguage', 20],
  ];

  for (const [key, weight] of weights) {
    const val = profile[key];
    if (key === 'preferredColleges') {
      if (Array.isArray(val) && val.length > 0) filled += weight;
      else if (profile._shortlistSkipped) filled += weight;
    } else if (val != null && String(val).trim() !== '') {
      filled += weight;
    }
  }

  return Math.min(100, filled);
}

function refreshProfile(profile) {
  const next = { ...profile };
  next.profileCompletionPct = computeProfileCompletion(next);
  return next;
}

function buildEntryReply(userText) {
  const lines = [
    getMessage('greeting'),
    '',
    getMessage('professional_intro'),
    '',
    getMessage('ask_qualification'),
  ];

  const trimmed = String(userText || '').trim();
  if (trimmed && !isSocialGreetingOnly(trimmed)) {
    lines.unshift(`Got it — "${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}".`);
    lines.splice(1, 0, '');
  }

  return lines.join('\n');
}

function buildProfileSummary(profile) {
  const lines = [getMessage('profile_summary_header'), ''];

  if (profile.currentQualification) {
    lines.push(`• Qualification: ${profile.currentQualification}`);
  }
  if (profile.currentClass) {
    lines.push(`• Current class / year: ${profile.currentClass}`);
  }
  if (profile.preferredCourse) {
    lines.push(`• Intended course: ${profile.preferredCourse}`);
  }
  if (profile.careerGoal) {
    lines.push(`• Career goal: ${profile.careerGoal}`);
  }
  if (Array.isArray(profile.preferredColleges) && profile.preferredColleges.length > 0) {
    lines.push(`• Shortlisted colleges: ${profile.preferredColleges.join(', ')}`);
  } else if (profile._shortlistSkipped) {
    lines.push('• Shortlisted colleges: Not shortlisted yet');
  }
  if (profile.preferredLanguage) {
    lines.push(`• Preferred language: ${profile.preferredLanguage}`);
  }

  lines.push(`• Profile completion: ${profile.profileCompletionPct}%`);
  return lines.join('\n');
}

function buildDiscoveryCompleteIntro(profile) {
  return [
    getMessage('discovery_complete_intro'),
    '',
    buildProfileSummary(profile),
  ].join('\n');
}

function applyProfilePatch(profile, patch) {
  const { rawAnswer, questionKey, skipped, ...fields } = patch;
  const next = { ...profile, ...fields };
  if (rawAnswer != null && rawAnswer !== '') {
    next.conversationContext = appendConversationContext(next, {
      questionKey: questionKey || null,
      answer: String(rawAnswer).slice(0, 500),
    });
  }
  return refreshProfile(next);
}

function advanceAfterAnswer(ctx, answeredStep, profilePatch, analyticsMeta) {
  const profile = applyProfilePatch(ctx.profile, {
    ...profilePatch,
    questionKey: answeredStep.replace(/^awaiting_/, ''),
  });

  logDiscoveryQuestionAnswered({
    stage: ctx.stage,
    step: answeredStep,
    questionKey: answeredStep.replace(/^awaiting_/, ''),
    profileCompletionPct: profile.profileCompletionPct,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: ctx.stage,
    step: answeredStep,
    profileCompletionPct: profile.profileCompletionPct,
    fieldsUpdated: Object.keys(profilePatch).filter((k) => !k.startsWith('_') && k !== 'rawAnswer' && k !== 'questionKey'),
    ...analyticsMeta,
  });

  const nextStep = getNextStep(answeredStep);
  if (!nextStep) {
    const discoveryDoneCtx = {
      ...ctx,
      stage: STAGES.DISCOVERY,
      step: 'discovery_complete',
      profile,
      lastQuestionKey: 'discovery_complete',
      discoveryCompletedAt: new Date().toISOString(),
    };

    logDiscoveryCompleted({
      stage: STAGES.EVALUATION_FRAMEWORK,
      profileCompletionPct: profile.profileCompletionPct,
      ...analyticsMeta,
    });

    const evalStart = startEvaluation(discoveryDoneCtx, analyticsMeta);
    const intro = buildDiscoveryCompleteIntro(profile);
    return {
      reply: `${getAckForStep(answeredStep)}\n\n${intro}\n\n${evalStart.reply}`,
      context: evalStart.context,
      analytics: [
        { type: 'discovery_completed', profileCompletionPct: profile.profileCompletionPct },
        ...(evalStart.analytics || []),
      ],
    };
  }

  const ack = getAckForStep(answeredStep);
  const nextQuestion = getQuestionForStep(nextStep);

  return {
    reply: `${ack}\n\n${nextQuestion}`,
    context: {
      ...ctx,
      step: nextStep,
      profile,
      lastQuestionKey: nextStep.replace(/^awaiting_/, ''),
    },
    analytics: [{ type: 'discovery_question_answered', step: answeredStep }],
  };
}

function handleSkip(ctx, analyticsMeta) {
  const step = ctx.step;
  const patch = { rawAnswer: 'skipped', skipped: true };

  switch (step) {
    case 'awaiting_qualification':
      return {
        reply: `${getMessage('skip_note')}\n\n${getClarifyForStep(step)}`,
        context: ctx,
        analytics: [],
      };
    case 'awaiting_course':
      return {
        reply: `${getMessage('skip_note')}\n\n${getClarifyForStep(step)}`,
        context: ctx,
        analytics: [],
      };
    case 'awaiting_career_goal':
      return advanceAfterAnswer(ctx, step, { careerGoal: null, _goalSkipped: true, ...patch }, analyticsMeta);
    case 'awaiting_shortlist':
      return advanceAfterAnswer(
        ctx,
        step,
        { preferredColleges: [], _shortlistSkipped: true, ...patch },
        analyticsMeta
      );
    case 'awaiting_language':
      return advanceAfterAnswer(ctx, step, { preferredLanguage: null, _languageSkipped: true, ...patch }, analyticsMeta);
    default:
      return processEvaluationTurn('', ctx, { startEvaluation: true, analytics: analyticsMeta });
  }
}

function handleCorrection(inbound, ctx, analyticsMeta) {
  const field = detectCorrectionField(inbound, ctx);
  let parsed = null;
  const patch = { rawAnswer: inbound };

  if (field === 'qualification' || ctx.step === 'awaiting_qualification') {
    parsed = parseQualificationAnswer(inbound);
    if (parsed) {
      return {
        reply: `${getMessage('correction_ack')}\n\n${getAckForStep('awaiting_qualification')}\n\n${getQuestionForStep(ctx.step)}`,
        context: {
          ...ctx,
          profile: applyProfilePatch(ctx.profile, {
            currentQualification: parsed.currentQualification,
            currentClass: parsed.currentClass,
            questionKey: 'qualification_correction',
            rawAnswer: inbound,
          }),
        },
        analytics: [{ type: 'profile_correction', field: 'qualification' }],
      };
    }
  }

  if (field === 'course') {
    parsed = parseCourseAnswer(inbound);
    if (parsed) {
      return {
        reply: `${getMessage('correction_ack')}\n\n${getQuestionForStep(ctx.step)}`,
        context: {
          ...ctx,
          profile: applyProfilePatch(ctx.profile, {
            preferredCourse: parsed.preferredCourse,
            questionKey: 'course_correction',
            rawAnswer: inbound,
          }),
        },
        analytics: [{ type: 'profile_correction', field: 'course' }],
      };
    }
  }

  return {
    reply: `${getMessage('correction_ack')}\n\n${getClarifyForStep(ctx.step)}`,
    context: ctx,
    analytics: [],
  };
}

function handleStepAnswer(inbound, ctx, analyticsMeta) {
  switch (ctx.step) {
    case 'awaiting_qualification': {
      const parsed = parseQualificationAnswer(inbound);
      if (!parsed) {
        return {
          reply: getClarifyForStep(ctx.step),
          context: ctx,
          analytics: [],
        };
      }
      return advanceAfterAnswer(
        ctx,
        ctx.step,
        {
          currentQualification: parsed.currentQualification,
          currentClass: parsed.currentClass,
          rawAnswer: parsed.rawAnswer,
        },
        analyticsMeta
      );
    }
    case 'awaiting_course': {
      const parsed = parseCourseAnswer(inbound);
      if (!parsed) {
        return {
          reply: getClarifyForStep(ctx.step),
          context: ctx,
          analytics: [],
        };
      }
      return advanceAfterAnswer(
        ctx,
        ctx.step,
        { preferredCourse: parsed.preferredCourse, rawAnswer: parsed.rawAnswer },
        analyticsMeta
      );
    }
    case 'awaiting_career_goal': {
      const parsed = parseCareerGoalAnswer(inbound);
      if (!parsed) {
        return {
          reply: getClarifyForStep(ctx.step),
          context: ctx,
          analytics: [],
        };
      }
      return advanceAfterAnswer(
        ctx,
        ctx.step,
        { careerGoal: parsed.careerGoal, rawAnswer: parsed.rawAnswer },
        analyticsMeta
      );
    }
    case 'awaiting_shortlist': {
      const parsed = parseShortlistAnswer(inbound);
      if (!parsed) {
        return {
          reply: getClarifyForStep(ctx.step),
          context: ctx,
          analytics: [],
        };
      }
      return advanceAfterAnswer(
        ctx,
        ctx.step,
        {
          preferredColleges: parsed.preferredColleges,
          _shortlistSkipped: Boolean(parsed.skipped),
          rawAnswer: parsed.rawAnswer,
        },
        analyticsMeta
      );
    }
    case 'awaiting_language': {
      const parsed = parseLanguageAnswer(inbound);
      if (!parsed) {
        return {
          reply: getClarifyForStep(ctx.step),
          context: ctx,
          analytics: [],
        };
      }
      return advanceAfterAnswer(
        ctx,
        ctx.step,
        { preferredLanguage: parsed.preferredLanguage, rawAnswer: parsed.rawAnswer },
        analyticsMeta
      );
    }
    default:
      return processEvaluationTurn(inbound, ctx, { analytics: analyticsMeta });
  }
}

async function processDiscoveryTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const isNewEntry = Boolean(opts.isNewEntry);
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  const inEvaluation =
    ctx.stage === STAGES.EVALUATION_FRAMEWORK ||
    ctx.stage === STAGES.MODERN_COLLEGES ||
    ctx.stage === STAGES.PERSONALIZED_DISCOVERY ||
    ctx.stage === STAGES.EXPLORE_MODERN_COLLEGES ||
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
    ctx.stage === EVAL_STAGES.EVALUATION_FRAMEWORK ||
    ctx.stage === EVAL_STAGES.MODERN_COLLEGES ||
    ctx.stage === EVAL_STAGES.PERSONALIZED_SHORTLISTING ||
    ctx.stage === EVAL_STAGES.SMART_COMPARISON ||
    ctx.stage === EVAL_STAGES.CONCERN_RESOLUTION ||
    ctx.stage === EVAL_STAGES.CONCERN_RESOLUTION_PLACEHOLDER ||
    ctx.stage === EVAL_STAGES.COUNSELING_INVITATION ||
    ctx.stage === EVAL_STAGES.COUNSELING_INVITATION_PLACEHOLDER ||
    ctx.stage === EVAL_STAGES.CONVERSATION_COMPLETE ||
    (typeof ctx.step === 'string' &&
      (ctx.step.startsWith('eval_') ||
        ctx.step.startsWith('modern_') ||
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
        ctx.step === 'modern_colleges_placeholder' ||
        ctx.step === 'evaluation_framework_placeholder' ||
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
        ctx.step.startsWith('invite_') ||
        ctx.step === 'counseling_invitation_placeholder' ||
        ctx.step === 'conversation_complete'));

  if (inEvaluation && !isNewEntry) {
    return processEvaluationTurn(inbound, ctx, { analytics: analyticsMeta });
  }

  if (isNewEntry || !ctx.flow || ctx.version !== 2 || !ctx.step) {
    ctx = initialContext();
    ctx.discoveryStartedAt = new Date().toISOString();

    if (opts.preferredLanguage && !ctx.profile.preferredLanguage) {
      ctx.profile = refreshProfile({
        ...ctx.profile,
        preferredLanguage: opts.preferredLanguage,
      });
    }

    logDiscoveryStarted({
      stage: ctx.stage,
      step: ctx.step,
      profileCompletionPct: ctx.profile.profileCompletionPct,
      ...analyticsMeta,
    });

    return {
      reply: buildEntryReply(inbound),
      context: ctx,
      clearState: false,
      analytics: [{ type: 'discovery_started' }],
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
      reply: `${getMessage('greeting_mid_journey')}\n\n${getQuestionForStep(ctx.step)}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isCorrectionResponse(inbound)) {
    const result = handleCorrection(inbound, ctx, analyticsMeta);
    return { ...result, clearState: false };
  }

  if (isSkipResponse(inbound)) {
    const result = handleSkip(ctx, analyticsMeta);
    return { ...result, clearState: false };
  }

  const result = handleStepAnswer(inbound, ctx, analyticsMeta);
  return { ...result, clearState: false };
}

module.exports = {
  FLOW_ID,
  STAGES,
  DISCOVERY_STEPS,
  emptyProfile,
  initialContext,
  computeProfileCompletion,
  processDiscoveryTurn,
  buildProfileSummary,
  startEvaluation,
};
