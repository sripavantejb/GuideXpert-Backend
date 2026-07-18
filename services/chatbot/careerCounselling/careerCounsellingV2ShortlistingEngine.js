'use strict';

const {
  STAGES,
  SHORTLISTING_STEPS,
  RECOMMENDATION_MATRIX_VERSION,
  SHORTLIST_QA,
  getShortlistMessage,
} = require('../../../constants/careerCounsellingV2Shortlisting');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const {
  isSkipResponse,
  isSocialGreetingOnly,
} = require('./careerCounsellingV2ResponseParser');
const {
  parseExamAnswer,
  parseRankAnswer,
  parseCategoryAnswer,
  parseRegionAnswer,
  isShortlistAcknowledgment,
  isPermissionYes,
  isPermissionNo,
  isShortlistQuestion,
} = require('./careerCounsellingV2ShortlistingParser');
const {
  buildEligibilityRequest,
  retrieveEligibleColleges,
} = require('./careerCounsellingV2EligibilityService');
const {
  scoreEligibleColleges,
  tierRecommendations,
  calculateRecommendationConfidence,
} = require('./careerCounsellingV2RecommendationMatrix');
const {
  logShortlistStarted,
  logEligibilityRetrieved,
  logRecommendationGenerated,
  logRecommendationViewed,
  logRecommendationReasonViewed,
  logRecommendationConfidence,
  logShortlistCompleted,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function answerShortlistQuestion(text) {
  const t = String(text || '').trim();
  for (const entry of SHORTLIST_QA) {
    if (entry.patterns.some((re) => re.test(t))) return entry.answer;
  }
  return getShortlistMessage('question_fallback');
}

function profileReadyForShortlist(profile = {}) {
  const score = Number(profile.counselingConfidenceScore);
  const hasCore =
    Boolean(profile.preferredCourse || profile.careerGoal) &&
    (Boolean(profile.careerPriority) ||
      Boolean(profile.preferredLearningStyle) ||
      (Array.isArray(profile.evaluationPriorities) && profile.evaluationPriorities.length > 0));
  if (Number.isFinite(score) && score >= 60 && hasCore) return true;
  return hasCore && Boolean(profile.modernEducationCompleted || profile.evaluationCompleted);
}

function nextMissingPrompt(missing = []) {
  if (missing.includes('exam')) return { step: 'shortlist_ask_exam', message: getShortlistMessage('ask_exam') };
  if (missing.includes('rank')) return { step: 'shortlist_ask_rank', message: getShortlistMessage('ask_rank') };
  if (missing.includes('category')) {
    return { step: 'shortlist_ask_category', message: getShortlistMessage('ask_category') };
  }
  if (missing.includes('region')) {
    return { step: 'shortlist_ask_category', message: getShortlistMessage('ask_region'), focus: 'region' };
  }
  return null;
}

function formatCollegeBlock(item, tier) {
  const lines = [];
  const title = item.branchName
    ? `${item.collegeName} — ${item.branchName}`
    : item.collegeName;
  lines.push(`• ${title}`);
  if (tier === 'best' || tier === 'strong') {
    lines.push('  Why it matches:');
    for (const why of item.reasons.why.slice(0, 2)) {
      lines.push(`  ✅ ${why}`);
    }
    if (item.reasons.consider.length > 0) {
      lines.push(`  Note: ${item.reasons.consider[0]}`);
    }
  } else {
    lines.push('  Why it was included:');
    for (const why of item.reasons.why.slice(0, 2)) {
      lines.push(`  - ${why}`);
    }
    if (item.reasons.consider[0]) {
      lines.push(`  Trade-off: ${item.reasons.consider[0]}`);
    }
  }
  return lines.join('\n');
}

function formatShortlistReply(tiers, confidence) {
  const sections = [getShortlistMessage('present_header'), ''];

  if (tiers.bestMatch.length > 0) {
    sections.push(getShortlistMessage('best_match_header'));
    for (const item of tiers.bestMatch) {
      sections.push(formatCollegeBlock(item, 'best'));
      sections.push('');
    }
  }

  if (tiers.strongAlternatives.length > 0) {
    sections.push(getShortlistMessage('strong_header'));
    for (const item of tiers.strongAlternatives) {
      sections.push(formatCollegeBlock(item, 'strong'));
      sections.push('');
    }
  }

  if (tiers.worthExploring.length > 0) {
    sections.push(getShortlistMessage('explore_header'));
    for (const item of tiers.worthExploring) {
      sections.push(formatCollegeBlock(item, 'explore'));
      sections.push('');
    }
  }

  sections.push(getShortlistMessage('confidence_line', confidence));
  sections.push('');
  sections.push(getShortlistMessage('ask_compare'));
  return sections.join('\n').trim();
}

function persistRecommendation(profile, tiers, confidence, eligibleCount) {
  const flatten = [
    ...tiers.bestMatch.map((c) => ({ ...c, tier: 'best_match' })),
    ...tiers.strongAlternatives.map((c) => ({ ...c, tier: 'strong_alternative' })),
    ...tiers.worthExploring.map((c) => ({ ...c, tier: 'worth_exploring' })),
  ];

  const reasons = {};
  for (const item of flatten) {
    reasons[item.collegeName] = item.reasons;
  }

  return {
    ...profile,
    recommendedColleges: flatten.map((c) => ({
      collegeName: c.collegeName,
      branchName: c.branchName,
      branchCode: c.branchCode,
      tier: c.tier,
      cutoff: c.cutoff,
      fee: c.fee,
    })),
    recommendationReasons: reasons,
    recommendationConfidence: confidence,
    recommendationMatrixVersion: RECOMMENDATION_MATRIX_VERSION,
    eligibleCollegeCount: eligibleCount,
  };
}

async function generateAndPresent(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };

  const eligibility = await retrieveEligibleColleges(profile, { limit: 40 });

  if (!eligibility.ok || eligibility.colleges.length === 0) {
    logEligibilityRetrieved({
      stage: STAGES.AI_SHORTLISTING,
      exam: profile.exam || null,
      rank: profile.rank || null,
      eligibleCount: 0,
      success: false,
      ...analyticsMeta,
    });
    return {
      reply: getShortlistMessage('no_eligibility'),
      context: {
        ...ctx,
        step: 'shortlist_validate',
        lastEligibilityError: eligibility.error ? String(eligibility.error.message || eligibility.error) : 'empty',
      },
      clearState: false,
      analytics: [{ type: 'eligibility_failed' }],
    };
  }

  logEligibilityRetrieved({
    stage: STAGES.AI_SHORTLISTING,
    exam: profile.exam || null,
    rank: profile.rank || null,
    eligibleCount: eligibility.colleges.length,
    total: eligibility.total,
    success: true,
    ...analyticsMeta,
  });

  const scored = scoreEligibleColleges(eligibility.colleges, profile);
  const tiers = tierRecommendations(scored);
  const confidence = calculateRecommendationConfidence(
    profile,
    tiers,
    eligibility.colleges.length
  );
  const nextProfile = persistRecommendation(profile, tiers, confidence, eligibility.colleges.length);

  logRecommendationGenerated({
    stage: STAGES.AI_SHORTLISTING,
    recommendedCount: nextProfile.recommendedColleges.length,
    recommendationConfidence: confidence,
    recommendationMatrixVersion: RECOMMENDATION_MATRIX_VERSION,
    ...analyticsMeta,
  });

  logRecommendationViewed({
    stage: STAGES.AI_SHORTLISTING,
    recommendedCount: nextProfile.recommendedColleges.length,
    ...analyticsMeta,
  });

  logRecommendationReasonViewed({
    stage: STAGES.AI_SHORTLISTING,
    reasonCount: Object.keys(nextProfile.recommendationReasons || {}).length,
    ...analyticsMeta,
  });

  logRecommendationConfidence({
    stage: STAGES.AI_SHORTLISTING,
    recommendationConfidence: confidence,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.AI_SHORTLISTING,
    fieldsUpdated: [
      'recommendedColleges',
      'recommendationReasons',
      'recommendationConfidence',
      'recommendationMatrixVersion',
    ],
    ...analyticsMeta,
  });

  logShortlistCompleted({
    stage: STAGES.AI_SHORTLISTING,
    recommendationConfidence: confidence,
    ...analyticsMeta,
  });

  return {
    reply: formatShortlistReply(tiers, confidence),
    context: {
      ...ctx,
      stage: STAGES.AI_SHORTLISTING,
      step: 'shortlist_ask_compare',
      profile: nextProfile,
      lastQuestionKey: 'compare_permission',
      shortlistCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'recommendation_generated' },
      { type: 'shortlist_completed' },
    ],
  };
}

async function continueAfterEligibilityFields(ctx, analyticsMeta) {
  const built = buildEligibilityRequest(ctx.profile || {});
  if (!built.ok) {
    const prompt = nextMissingPrompt(built.missing);
    if (!prompt) {
      return {
        reply: getShortlistMessage('no_eligibility'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    return {
      reply: prompt.message,
      context: {
        ...ctx,
        step: prompt.step,
        eligibilityFocus: prompt.focus || null,
        lastQuestionKey: prompt.step,
      },
      clearState: false,
      analytics: [],
    };
  }

  return generateAndPresent(ctx, analyticsMeta);
}

function startAiShortlisting(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };

  if (!profileReadyForShortlist(profile)) {
    return {
      reply: getShortlistMessage('profile_incomplete'),
      context: {
        ...ctx,
        stage: STAGES.AI_SHORTLISTING,
        step: 'shortlist_validate',
        profile,
      },
      clearState: false,
      analytics: [{ type: 'shortlist_profile_incomplete' }],
    };
  }

  logShortlistStarted({
    stage: STAGES.AI_SHORTLISTING,
    counselingConfidenceScore: profile.counselingConfidenceScore ?? null,
    ...analyticsMeta,
  });

  const built = buildEligibilityRequest(profile);
  const nextCtx = {
    ...ctx,
    stage: STAGES.AI_SHORTLISTING,
    step: 'shortlist_validate',
    profile,
    shortlistStartedAt: new Date().toISOString(),
  };

  if (!built.ok) {
    const prompt = nextMissingPrompt(built.missing);
    return {
      reply: `${getShortlistMessage('shortlist_intro')}\n\n${prompt.message}`,
      context: {
        ...nextCtx,
        step: prompt.step,
        eligibilityFocus: prompt.focus || null,
        lastQuestionKey: prompt.step,
      },
      clearState: false,
      analytics: [{ type: 'shortlist_started' }],
    };
  }

  // Defer async generation to process turn with generating ack path
  return {
    reply: `${getShortlistMessage('shortlist_intro')}\n\n${getShortlistMessage('generating')}`,
    context: {
      ...nextCtx,
      step: 'shortlist_generate',
      lastQuestionKey: 'generate',
    },
    clearState: false,
    analytics: [{ type: 'shortlist_started' }],
    _generateNow: true,
  };
}

async function processAiShortlistingTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startAiShortlisting ||
    ctx.step === 'ai_shortlisting_placeholder' ||
    (ctx.stage === STAGES.AI_SHORTLISTING &&
      !SHORTLISTING_STEPS.includes(ctx.step) &&
      ctx.step !== 'shortlist_generate' &&
      ctx.step !== 'shortlist_permission_declined' &&
      ctx.step !== 'comparison_placeholder' &&
      ctx.step !== 'concern_resolution_placeholder' &&
      ctx.step !== 'phase9_personalized_recommendation_placeholder' &&
      ctx.step !== 'phase10_future_path_vision_placeholder' &&
      ctx.step !== 'phase11_final_decision_hesitation_placeholder' &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      ctx.step !== 'conversation_complete' &&
      !String(ctx.step || '').startsWith('compare_') &&
      !String(ctx.step || '').startsWith('concern_') &&
      !String(ctx.step || '').startsWith('phase9_') &&
      !String(ctx.step || '').startsWith('vision_') &&
      !String(ctx.step || '').startsWith('hesitation_') &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      !String(ctx.step || '').startsWith('invite_'))
  ) {
    const started = startAiShortlisting(ctx, analyticsMeta);
    if (started._generateNow) {
      const presented = await generateAndPresent(started.context, analyticsMeta);
      return {
        reply: `${started.reply}\n\n${presented.reply}`,
        context: presented.context,
        clearState: false,
        analytics: [...(started.analytics || []), ...(presented.analytics || [])],
      };
    }
    return started;
  }

  if (
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
      (ctx.step.startsWith('compare_') ||
        ctx.step.startsWith('concern_') ||
        ctx.step.startsWith('phase9_') ||
        ctx.step.startsWith('vision_') ||
        ctx.step.startsWith('hesitation_') ||
        ctx.step.startsWith('counsel_rec_') ||
        ctx.step.startsWith('booking_') ||
        ctx.step.startsWith('invite_')))
  ) {
    const {
      processSmartComparisonTurn,
    } = require('./careerCounsellingV2ComparisonEngine');
    return processSmartComparisonTurn(inbound, ctx, {
      startSmartComparison:
        ctx.step === 'comparison_placeholder' ||
        opts.startSmartComparison ||
        (ctx.stage === STAGES.COMPARISON_PLACEHOLDER && !String(ctx.step || '').startsWith('compare_')),
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
      reply: `${getShortlistMessage('greeting_mid')}\n\n${getShortlistMessage('awaiting_ack_nudge')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isShortlistQuestion(inbound) && ctx.step !== 'shortlist_ask_compare') {
    return {
      reply: `${answerShortlistQuestion(inbound)}\n\n${getShortlistMessage('resume_checkpoint_prefix')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'shortlist_generate') {
    return generateAndPresent(ctx, analyticsMeta);
  }

  if (ctx.step === 'shortlist_ask_exam') {
    const parsed = parseExamAnswer(inbound);
    if (!parsed) {
      return {
        reply: getShortlistMessage('ask_exam'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    ctx = {
      ...ctx,
      profile: { ...ctx.profile, exam: parsed.exam, entranceExam: parsed.exam },
    };
    return continueAfterEligibilityFields(ctx, analyticsMeta);
  }

  if (ctx.step === 'shortlist_ask_rank') {
    const parsed = parseRankAnswer(inbound);
    if (!parsed) {
      return {
        reply: getShortlistMessage('ask_rank'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    ctx = {
      ...ctx,
      profile: { ...ctx.profile, rank: parsed.rank },
    };
    return continueAfterEligibilityFields(ctx, analyticsMeta);
  }

  if (ctx.step === 'shortlist_ask_category') {
    if (ctx.eligibilityFocus === 'region') {
      const parsed = parseRegionAnswer(inbound);
      if (!parsed) {
        return {
          reply: getShortlistMessage('ask_region'),
          context: ctx,
          clearState: false,
          analytics: [],
        };
      }
      ctx = {
        ...ctx,
        profile: {
          ...ctx.profile,
          region: parsed.region,
          admissionCategory: parsed.admissionCategory,
        },
        eligibilityFocus: null,
      };
      return continueAfterEligibilityFields(ctx, analyticsMeta);
    }

    const parsed = parseCategoryAnswer(inbound);
    if (!parsed) {
      return {
        reply: getShortlistMessage('ask_category'),
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    ctx = {
      ...ctx,
      profile: {
        ...ctx.profile,
        category: parsed.category,
        gender: parsed.gender || ctx.profile.gender || 'female',
        reservationCategory: parsed.reservationCategory || ctx.profile.reservationCategory,
      },
    };
    return continueAfterEligibilityFields(ctx, analyticsMeta);
  }

  if (ctx.step === 'shortlist_validate') {
    if (isShortlistAcknowledgment(inbound) || inbound.length >= 2) {
      return continueAfterEligibilityFields(ctx, analyticsMeta);
    }
    return {
      reply: getShortlistMessage('awaiting_ack_nudge'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'shortlist_ask_compare' || ctx.step === 'shortlist_present') {
    if (isPermissionYes(inbound)) {
      const {
        processSmartComparisonTurn,
      } = require('./careerCounsellingV2ComparisonEngine');
      return processSmartComparisonTurn(inbound, ctx, {
        startSmartComparison: true,
        analytics: analyticsMeta,
      });
    }
    if (isPermissionNo(inbound)) {
      return {
        reply: getShortlistMessage('permission_no'),
        context: {
          ...ctx,
          step: 'shortlist_permission_declined',
          lastQuestionKey: 'compare_declined',
        },
        clearState: false,
        analytics: [],
      };
    }
    if (isShortlistQuestion(inbound)) {
      return {
        reply: `${answerShortlistQuestion(inbound)}\n\n${getShortlistMessage('permission_clarify')}`,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    return {
      reply: getShortlistMessage('permission_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'shortlist_permission_declined') {
    if (isPermissionYes(inbound)) {
      return {
        reply: getShortlistMessage('ask_compare'),
        context: { ...ctx, step: 'shortlist_ask_compare' },
        clearState: false,
        analytics: [],
      };
    }
    return {
      reply: getShortlistMessage('permission_declined_reengage'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startAiShortlisting(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  SHORTLISTING_STEPS,
  startAiShortlisting,
  processAiShortlistingTurn,
  formatShortlistReply,
  profileReadyForShortlist,
};
