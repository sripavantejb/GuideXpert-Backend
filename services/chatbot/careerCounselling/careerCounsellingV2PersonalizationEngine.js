'use strict';

const {
  STAGES,
  PERSONALIZATION_STEPS,
  PERSONALIZATION_QA,
  getPersMessage,
  getNextPersStep,
  getPersContentForStep,
  buildPersonalizedPersTransition,
} = require('../../../constants/careerCounsellingV2Personalization');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const {
  isSkipResponse,
  isSocialGreetingOnly,
} = require('./careerCounsellingV2ResponseParser');
const {
  parseCareerPriority,
  parseLocationPreferences,
  parseBudgetPreferences,
  parseFamilyPreferences,
  parseConcerns,
  isPersAcknowledgment,
  isPersQuestion,
  isPermissionYes,
  isPermissionNo,
  calculateCounselingConfidence,
  getMissingClarifications,
} = require('./careerCounsellingV2PersonalizationParser');
const {
  logPersonalizationStarted,
  logCareerPriorityCaptured,
  logLocationPreferenceCaptured,
  logBudgetPreferenceCaptured,
  logParentPreferencesCaptured,
  logConcernCaptured,
  logCounselingProfileCompleted,
  logCounselingConfidenceCalculated,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function answerPersQuestion(text) {
  const t = String(text || '').trim();
  for (const entry of PERSONALIZATION_QA) {
    if (entry.patterns.some((re) => re.test(t))) {
      return entry.answer;
    }
  }
  return getPersMessage('question_fallback');
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
      questionKey: fields._questionKey || 'personalization',
      answer: String(fields._rawAnswer).slice(0, 500),
    });
    delete next._rawAnswer;
    delete next._questionKey;
  }
  return next;
}

function ensurePersProfileFields(profile = {}) {
  return {
    ...profile,
    careerPriority: profile.careerPriority ?? null,
    preferredLocation: profile.preferredLocation ?? null,
    relocationPreference: profile.relocationPreference ?? null,
    hostelRequired: profile.hostelRequired ?? null,
    budgetPreference: profile.budgetPreference ?? null,
    financialPreference: profile.financialPreference ?? null,
    parentPreferences: profile.parentPreferences ?? null,
    familyConstraints: Array.isArray(profile.familyConstraints) ? profile.familyConstraints : [],
    biggestConcerns: Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : [],
    recommendationConfidence: profile.recommendationConfidence ?? null,
    counselingConfidenceScore: profile.counselingConfidenceScore ?? null,
  };
}

function buildProfileSummary(profile) {
  const lines = [getPersMessage('summary_header'), ''];
  if (profile.preferredCourse) lines.push(`• Course interest: ${profile.preferredCourse}`);
  if (profile.careerGoal) lines.push(`• Career goal: ${profile.careerGoal}`);
  if (profile.preferredLearningStyle) {
    lines.push(`• Learning style: ${profile.preferredLearningStyle}`);
  }
  if (profile.careerPriority) lines.push(`• Career priority: ${profile.careerPriority}`);
  if (profile.preferredLocation) lines.push(`• Preferred location: ${profile.preferredLocation}`);
  if (profile.relocationPreference) {
    lines.push(`• Relocation: ${profile.relocationPreference}`);
  }
  if (profile.hostelRequired != null) {
    lines.push(`• Hostel: ${profile.hostelRequired ? 'needed / preferred' : 'not required'}`);
  }
  if (profile.budgetPreference) lines.push(`• Budget: ${profile.budgetPreference}`);
  if (profile.financialPreference) lines.push(`• Funding: ${profile.financialPreference}`);
  if (profile.parentPreferences) {
    lines.push(`• Family preferences: ${String(profile.parentPreferences).slice(0, 160)}`);
  }
  if (Array.isArray(profile.biggestConcerns) && profile.biggestConcerns.length > 0) {
    lines.push(`• Biggest concerns: ${profile.biggestConcerns.join(', ')}`);
  }
  if (profile.counselingConfidenceScore != null) {
    lines.push(`• Counseling confidence: ${profile.counselingConfidenceScore}%`);
  }
  return lines.join('\n');
}

function applyConfidence(profile) {
  const score = calculateCounselingConfidence(profile);
  let band = 'low';
  if (score >= 80) band = 'high';
  else if (score >= 60) band = 'medium';

  return {
    ...profile,
    counselingConfidenceScore: score,
    recommendationConfidence: band,
  };
}

function startPersonalizedDiscovery(ctx, analyticsMeta = {}) {
  const profile = ensurePersProfileFields(ctx.profile);

  const nextCtx = {
    ...ctx,
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: 'pers_transition',
    profile,
    lastQuestionKey: 'pers_transition',
    clarifyQueue: [],
    personalizationStartedAt: new Date().toISOString(),
  };

  logPersonalizationStarted({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: 'pers_transition',
    profileCompletionPct: profile.profileCompletionPct ?? null,
    ...analyticsMeta,
  });

  return {
    reply: buildPersonalizedPersTransition(profile),
    context: nextCtx,
    clearState: false,
    analytics: [{ type: 'personalization_started' }],
  };
}

/**
 * Stage 5 YES handoff: Top-3 preview + first real Stage 6 question (budget).
 * Skips pers_transition Ready? gate. Single keepIntact bubble.
 */
function startPersonalizedDiscoveryFromExplore(ctx, analyticsMeta = {}, opts = {}) {
  const {
    formatStage5Preview,
  } = require('./careerCounsellingV2ExploreModernCollegesEngine');
  const profile = ensurePersProfileFields(ctx.profile);
  const preview = Array.isArray(profile.stage5PreviewInstitutions)
    ? profile.stage5PreviewInstitutions
    : [];
  const previewBody = formatStage5Preview(preview);
  const firstStep = 'pers_budget';
  const firstQ = getPersContentForStep(firstStep);
  const soft = String(opts.softDeclinePrefix || '').trim();
  const reply = [soft, previewBody, firstQ].filter(Boolean).join('\n\n');

  const nextCtx = {
    ...ctx,
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: firstStep,
    profile,
    lastQuestionKey: 'budget',
    clarifyQueue: [],
    personalizationStartedAt: new Date().toISOString(),
    fromExplorePreview: true,
  };

  logPersonalizationStarted({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: firstStep,
    profileCompletionPct: profile.profileCompletionPct ?? null,
    source: 'stage5_preview',
    ...analyticsMeta,
  });

  return {
    reply,
    context: nextCtx,
    clearState: false,
    keepIntact: true,
    skipLineCap: true,
    analytics: [
      { type: 'personalization_started', source: 'stage5_preview' },
      { type: 'stage5_preview_presented', count: preview.length },
    ],
  };
}

/**
 * Predictor bridge → Stage 6: skip Evaluation/Modern/Showcase; jump to first real slot.
 */
function startPersonalizedDiscoveryFromPredictor(ctx, analyticsMeta = {}) {
  const profile = ensurePersProfileFields({
    ...(ctx.profile || {}),
    bridgedFromCollegePredictor: true,
  });
  const firstStep = 'pers_career_priority';
  const ack = [
    "I've got your predicted colleges based on your rank.",
    "To help you choose between them, I'd like to understand a few preferences.",
  ].join('\n');
  const firstQ = getPersContentForStep(firstStep);
  const reply = `${ack}\n\n${firstQ}`;

  const nextCtx = {
    ...ctx,
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: firstStep,
    profile,
    lastQuestionKey: 'career_priority',
    clarifyQueue: [],
    personalizationStartedAt: new Date().toISOString(),
    fromPredictorBridge: true,
  };

  logPersonalizationStarted({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: firstStep,
    profileCompletionPct: profile.profileCompletionPct ?? null,
    source: 'college_predictor_bridge',
    ...analyticsMeta,
  });

  return {
    reply,
    context: nextCtx,
    clearState: false,
    keepIntact: true,
    skipLineCap: true,
    analytics: [{ type: 'personalization_started', source: 'college_predictor_bridge' }],
  };
}

function deliverStep(step, ctx, analyticsMeta = {}, prefix = '') {
  const content = getPersContentForStep(step);
  const reply = prefix ? `${prefix}\n\n${content}` : content;
  return {
    reply,
    context: {
      ...ctx,
      step,
      lastQuestionKey: step.replace(/^pers_/, ''),
    },
    clearState: false,
    analytics: [{ type: 'personalization_step', step }],
  };
}

function afterCapture(ctx, profile, answeredStep, analyticsMeta, ackKey, logFn, logFields) {
  if (typeof logFn === 'function') {
    logFn({
      stage: STAGES.PERSONALIZED_DISCOVERY,
      step: answeredStep,
      ...logFields,
      ...analyticsMeta,
    });
  }

  logProfileUpdated({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    step: answeredStep,
    fieldsUpdated: Object.keys(logFields || {}),
    ...analyticsMeta,
  });

  const nextStep = getNextPersStep(answeredStep, profile);
  if (!nextStep) {
    return runSummaryAndConfidence({ ...ctx, profile }, analyticsMeta);
  }

  const ack = getPersMessage(ackKey);
  return deliverStep(nextStep, { ...ctx, profile }, analyticsMeta, ack);
}

function runSummaryAndConfidence(ctx, analyticsMeta = {}) {
  let profile = applyConfidence(ensurePersProfileFields(ctx.profile));
  const score = profile.counselingConfidenceScore;

  logCounselingConfidenceCalculated({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    counselingConfidenceScore: score,
    recommendationConfidence: profile.recommendationConfidence,
    ...analyticsMeta,
  });

  const summary = buildProfileSummary(profile);

  if (score >= 80) {
    profile = { ...profile };
    logCounselingProfileCompleted({
      stage: STAGES.PERSONALIZED_DISCOVERY,
      counselingConfidenceScore: score,
      ...analyticsMeta,
    });

    return {
      reply: `${summary}\n\n${getPersMessage('confidence_high')}`,
      context: {
        ...ctx,
        step: 'pers_ask_permission',
        profile,
        lastQuestionKey: 'permission',
        clarifyQueue: [],
      },
      clearState: false,
      analytics: [
        { type: 'counseling_confidence_calculated', score },
        { type: 'counseling_profile_completed' },
      ],
    };
  }

  const missing = getMissingClarifications(profile);
  if (score >= 60 || missing.length === 0) {
    // Medium: ask up to 2 clarifying questions, then permission
    const queue = missing.slice(0, 2);
    if (queue.length === 0) {
      logCounselingProfileCompleted({
        stage: STAGES.PERSONALIZED_DISCOVERY,
        counselingConfidenceScore: score,
        ...analyticsMeta,
      });
      return {
        reply: `${summary}\n\n${getPersMessage('confidence_high')}`,
        context: {
          ...ctx,
          step: 'pers_ask_permission',
          profile,
          lastQuestionKey: 'permission',
          clarifyQueue: [],
        },
        clearState: false,
        analytics: [{ type: 'counseling_confidence_calculated', score }],
      };
    }

    const first = queue[0];
    return {
      reply: `${summary}\n\n${getPersMessage('confidence_medium')}\n\n${getPersMessage(first.messageKey)}`,
      context: {
        ...ctx,
        step: 'pers_clarify',
        profile,
        clarifyQueue: queue.slice(1),
        clarifyFocus: first.key,
        lastQuestionKey: 'clarify',
      },
      clearState: false,
      analytics: [{ type: 'counseling_confidence_calculated', score }],
    };
  }

  // Low confidence: keep discovering via missing clarifications
  const queue = missing.length > 0 ? missing : [
    { key: 'career', step: 'pers_career_priority', messageKey: 'clarify_career' },
  ];
  const first = queue[0];
  return {
    reply: `${summary}\n\n${getPersMessage('confidence_low')}\n\n${getPersMessage(first.messageKey)}`,
    context: {
      ...ctx,
      step: 'pers_clarify',
      profile,
      clarifyQueue: queue.slice(1),
      clarifyFocus: first.key,
      lastQuestionKey: 'clarify',
    },
    clearState: false,
    analytics: [{ type: 'counseling_confidence_calculated', score }],
  };
}

function handleClarifyAnswer(inbound, ctx, analyticsMeta) {
  const focus = ctx.clarifyFocus || 'career';
  let profile = { ...ctx.profile };
  let parsed = null;

  switch (focus) {
    case 'career':
      parsed = parseCareerPriority(inbound);
      if (parsed) {
        profile = patchProfile(profile, {
          careerPriority: parsed.careerPriority,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'career_priority_clarify',
        });
        logCareerPriorityCaptured({
          stage: STAGES.PERSONALIZED_DISCOVERY,
          careerPriority: parsed.careerPriority,
          ...analyticsMeta,
        });
      }
      break;
    case 'location':
      parsed = parseLocationPreferences(inbound);
      if (parsed) {
        profile = patchProfile(profile, {
          preferredLocation: parsed.preferredLocation,
          relocationPreference: parsed.relocationPreference,
          hostelRequired: parsed.hostelRequired,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'location_clarify',
        });
        logLocationPreferenceCaptured({
          stage: STAGES.PERSONALIZED_DISCOVERY,
          preferredLocation: parsed.preferredLocation,
          ...analyticsMeta,
        });
      }
      break;
    case 'budget':
      parsed = parseBudgetPreferences(inbound);
      if (parsed) {
        profile = patchProfile(profile, {
          budgetPreference: parsed.budgetPreference,
          financialPreference: parsed.financialPreference,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'budget_clarify',
        });
        logBudgetPreferenceCaptured({
          stage: STAGES.PERSONALIZED_DISCOVERY,
          budgetPreference: parsed.budgetPreference,
          ...analyticsMeta,
        });
      }
      break;
    case 'family':
      parsed = parseFamilyPreferences(inbound);
      if (parsed) {
        profile = patchProfile(profile, {
          parentPreferences: parsed.parentPreferences,
          familyConstraints: parsed.familyConstraints,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'family_clarify',
        });
        logParentPreferencesCaptured({
          stage: STAGES.PERSONALIZED_DISCOVERY,
          ...analyticsMeta,
        });
      }
      break;
    case 'concern':
      parsed = parseConcerns(inbound);
      if (parsed) {
        profile = patchProfile(profile, {
          biggestConcerns: parsed.biggestConcerns,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'concern_clarify',
        });
        logConcernCaptured({
          stage: STAGES.PERSONALIZED_DISCOVERY,
          biggestConcerns: parsed.biggestConcerns,
          ...analyticsMeta,
        });
      }
      break;
    default:
      break;
  }

  if (!parsed && !isSkipResponse(inbound)) {
    return {
      reply: getPersMessage('clarify_generic'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  profile = applyConfidence(profile);
  const queue = Array.isArray(ctx.clarifyQueue) ? [...ctx.clarifyQueue] : [];

  if (queue.length > 0 && profile.counselingConfidenceScore < 80) {
    const next = queue[0];
    return {
      reply: getPersMessage(next.messageKey),
      context: {
        ...ctx,
        profile,
        step: 'pers_clarify',
        clarifyQueue: queue.slice(1),
        clarifyFocus: next.key,
      },
      clearState: false,
      analytics: [{ type: 'clarify_continue' }],
    };
  }

  logCounselingProfileCompleted({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    counselingConfidenceScore: profile.counselingConfidenceScore,
    ...analyticsMeta,
  });

  logCounselingConfidenceCalculated({
    stage: STAGES.PERSONALIZED_DISCOVERY,
    counselingConfidenceScore: profile.counselingConfidenceScore,
    recommendationConfidence: profile.recommendationConfidence,
    ...analyticsMeta,
  });

  return {
    reply: `${buildProfileSummary(profile)}\n\n${getPersMessage('confidence_high')}`,
    context: {
      ...ctx,
      step: 'pers_ask_permission',
      profile,
      clarifyQueue: [],
      clarifyFocus: null,
      lastQuestionKey: 'permission',
    },
    clearState: false,
    analytics: [{ type: 'counseling_profile_completed' }],
  };
}

function handleCaptureStep(inbound, ctx, analyticsMeta) {
  switch (ctx.step) {
    case 'pers_career_priority': {
      const parsed = parseCareerPriority(inbound);
      if (!parsed) {
        return {
          reply: getPersMessage('clarify_career'),
          context: ctx,
          clearState: false,
          analytics: [],
        };
      }
      return afterCapture(
        ctx,
        patchProfile(ctx.profile, {
          careerPriority: parsed.careerPriority,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'career_priority',
        }),
        ctx.step,
        analyticsMeta,
        'ack_career',
        logCareerPriorityCaptured,
        { careerPriority: parsed.careerPriority }
      );
    }
    case 'pers_location': {
      const parsed = parseLocationPreferences(inbound);
      if (!parsed) {
        return {
          reply: getPersMessage('clarify_location'),
          context: ctx,
          clearState: false,
          analytics: [],
        };
      }
      return afterCapture(
        ctx,
        patchProfile(ctx.profile, {
          preferredLocation: parsed.preferredLocation,
          relocationPreference: parsed.relocationPreference,
          hostelRequired: parsed.hostelRequired,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'location',
        }),
        ctx.step,
        analyticsMeta,
        'ack_location',
        logLocationPreferenceCaptured,
        {
          preferredLocation: parsed.preferredLocation,
          relocationPreference: parsed.relocationPreference,
        }
      );
    }
    case 'pers_budget': {
      const parsed = parseBudgetPreferences(inbound);
      if (!parsed) {
        return {
          reply: getPersMessage('clarify_budget'),
          context: ctx,
          clearState: false,
          analytics: [],
        };
      }
      return afterCapture(
        ctx,
        patchProfile(ctx.profile, {
          budgetPreference: parsed.budgetPreference,
          financialPreference: parsed.financialPreference,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'budget',
        }),
        ctx.step,
        analyticsMeta,
        'ack_budget',
        logBudgetPreferenceCaptured,
        {
          budgetPreference: parsed.budgetPreference,
          financialPreference: parsed.financialPreference,
        }
      );
    }
    case 'pers_family': {
      const parsed = parseFamilyPreferences(inbound);
      if (!parsed) {
        return {
          reply: getPersMessage('clarify_family'),
          context: ctx,
          clearState: false,
          analytics: [],
        };
      }
      return afterCapture(
        ctx,
        patchProfile(ctx.profile, {
          parentPreferences: parsed.parentPreferences,
          familyConstraints: parsed.familyConstraints,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'family',
        }),
        ctx.step,
        analyticsMeta,
        'ack_family',
        logParentPreferencesCaptured,
        { parentPreferences: true }
      );
    }
    case 'pers_concern': {
      const parsed = parseConcerns(inbound);
      if (!parsed) {
        return {
          reply: getPersMessage('clarify_concern'),
          context: ctx,
          clearState: false,
          analytics: [],
        };
      }
      return afterCapture(
        ctx,
        patchProfile(ctx.profile, {
          biggestConcerns: parsed.biggestConcerns,
          _rawAnswer: parsed.rawAnswer,
          _questionKey: 'concern',
        }),
        ctx.step,
        analyticsMeta,
        'ack_concern',
        logConcernCaptured,
        { biggestConcerns: parsed.biggestConcerns }
      );
    }
    default:
      return startPersonalizedDiscovery(ctx, analyticsMeta);
  }
}

async function handlePermission(inbound, ctx, analyticsMeta = {}) {
  if (isPermissionYes(inbound)) {
    const { processAiShortlistingTurn } = require('./careerCounsellingV2ShortlistingEngine');
    return processAiShortlistingTurn(inbound, ctx, {
      startAiShortlisting: true,
      analytics: analyticsMeta,
    });
  }
  if (isPermissionNo(inbound)) {
    // Soft-advance: one decline then continue into shortlisting
    if (ctx.step === 'pers_permission_declined' || ctx.profile?._persDeclineCount >= 1) {
      const { processAiShortlistingTurn } = require('./careerCounsellingV2ShortlistingEngine');
      const advanced = await processAiShortlistingTurn(inbound, ctx, {
        startAiShortlisting: true,
        analytics: analyticsMeta,
      });
      return {
        ...advanced,
        skippedPhaseReason: 'user_declined_optional_gate',
      };
    }
    return {
      reply: getPersMessage('permission_no'),
      context: {
        ...ctx,
        step: 'pers_permission_declined',
        lastQuestionKey: 'permission_declined',
        profile: {
          ...(ctx.profile || {}),
          _persDeclineCount: 1,
        },
      },
      clearState: false,
      parked: true,
      analytics: [{ type: 'personalization_permission_declined' }],
    };
  }
  if (isPersQuestion(inbound)) {
    return {
      reply: `${answerPersQuestion(inbound)}\n\n${getPersMessage('permission_clarify')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }
  return {
    reply: getPersMessage('permission_clarify'),
    context: ctx,
    clearState: false,
    analytics: [],
  };
}

async function processPersonalizedDiscoveryTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startPersonalizedDiscovery ||
    ctx.step === 'personalized_shortlisting_placeholder' ||
    (ctx.stage === STAGES.PERSONALIZED_DISCOVERY &&
      !PERSONALIZATION_STEPS.includes(ctx.step) &&
      ctx.step !== 'pers_permission_declined' &&
      ctx.step !== 'ai_shortlisting_placeholder' &&
      !String(ctx.step || '').startsWith('shortlist_') &&
      !String(ctx.step || '').startsWith('compare_') &&
      !String(ctx.step || '').startsWith('concern_') &&
      !String(ctx.step || '').startsWith('phase9_') &&
      !String(ctx.step || '').startsWith('vision_') &&
      !String(ctx.step || '').startsWith('hesitation_') &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      ctx.step !== 'comparison_placeholder' &&
      ctx.step !== 'concern_resolution_placeholder' &&
      ctx.step !== 'phase9_personalized_recommendation_placeholder' &&
      ctx.step !== 'phase10_future_path_vision_placeholder' &&
      ctx.step !== 'phase11_final_decision_hesitation_placeholder' &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      ctx.step !== 'conversation_complete' &&
      !String(ctx.step || '').startsWith('invite_'))
  ) {
    return startPersonalizedDiscovery(ctx, analyticsMeta);
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

  if (isCareerCounsellingJourneyBreakout(inbound)) {
    return {
      reply: BREAKOUT_DEFLECTION,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isSocialGreetingOnly(inbound)) {
    const content = getPersContentForStep(ctx.step) || getPersMessage('awaiting_ack_nudge');
    return {
      reply: `${getPersMessage('greeting_mid')}\n\n${content}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isPersQuestion(inbound) && ctx.step !== 'pers_ask_permission') {
    const answer = answerPersQuestion(inbound);
    const resume = getPersContentForStep(ctx.step) || getPersMessage('awaiting_ack_nudge');
    return {
      reply: `${answer}\n\n${getPersMessage('resume_checkpoint_prefix')}\n${resume}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'pers_transition') {
    if (isPersAcknowledgment(inbound) || isSkipResponse(inbound) || inbound.length >= 2) {
      return deliverStep('pers_career_priority', ctx, analyticsMeta);
    }
    return {
      reply: getPersMessage('awaiting_ack_nudge'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'pers_clarify') {
    return handleClarifyAnswer(inbound, ctx, analyticsMeta);
  }

  if (ctx.step === 'pers_ask_permission') {
    return handlePermission(inbound, ctx, analyticsMeta);
  }

  if (ctx.step === 'pers_permission_declined') {
    if (isPermissionYes(inbound)) {
      return {
        reply: getPersMessage('ask_permission'),
        context: { ...ctx, step: 'pers_ask_permission', lastQuestionKey: 'permission' },
        clearState: false,
        analytics: [],
      };
    }
    return {
      reply: getPersMessage('permission_declined_reengage'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (
    [
      'pers_career_priority',
      'pers_location',
      'pers_budget',
      'pers_family',
      'pers_concern',
    ].includes(ctx.step)
  ) {
    if (isSkipResponse(inbound)) {
      // Soft skip still advances but leaves field empty (hurts confidence)
      const nextStep = getNextPersStep(ctx.step, ctx.profile || {});
      if (!nextStep) {
        return runSummaryAndConfidence(ctx, analyticsMeta);
      }
      return deliverStep(
        nextStep,
        ctx,
        analyticsMeta,
        'No problem — we can refine that later if needed.'
      );
    }
    return handleCaptureStep(inbound, ctx, analyticsMeta);
  }

  return startPersonalizedDiscovery(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  PERSONALIZATION_STEPS,
  startPersonalizedDiscovery,
  startPersonalizedDiscoveryFromExplore,
  startPersonalizedDiscoveryFromPredictor,
  processPersonalizedDiscoveryTurn,
  calculateCounselingConfidence,
  buildProfileSummary,
};
