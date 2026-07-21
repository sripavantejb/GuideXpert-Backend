'use strict';

const {
  STAGES,
  SHORTLISTING_STEPS,
  RECOMMENDATION_MATRIX_VERSION,
  SHORTLIST_PRESENT_LIMIT,
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

/**
 * Exam/rank eligibility shortlist only for predictor bridge or when exam+rank already known.
 * Normal counseling shortlists from curated new-age catalog (no ask_exam / ask_rank).
 */
function shouldUseExamEligibility(profile = {}) {
  if (profile.bridgedFromCollegePredictor) return true;
  const exam = profile.exam || profile.entranceExam;
  const rank = profile.rank != null ? Number(profile.rank) : NaN;
  return Boolean(exam) && Number.isFinite(rank) && rank > 0;
}

function profileReadyForShortlist(profile = {}) {
  const score = Number(profile.counselingConfidenceScore);
  const hasCore =
    Boolean(profile.preferredCourse || profile.careerGoal) &&
    (Boolean(profile.careerPriority) ||
      Boolean(profile.preferredLearningStyle) ||
      (Array.isArray(profile.evaluationPriorities) && profile.evaluationPriorities.length > 0) ||
      Boolean(profile.budgetPreference));
  if (Number.isFinite(score) && score >= 60 && hasCore) return true;
  return hasCore && Boolean(profile.modernEducationCompleted || profile.evaluationCompleted || profile.exploreModernCompleted);
}

function nextMissingPrompt(missing = [], profile = {}) {
  const useExam = shouldUseExamEligibility(profile);
  if (useExam && missing.includes('exam')) {
    return { step: 'shortlist_ask_exam', message: getShortlistMessage('ask_exam') };
  }
  if (useExam && missing.includes('rank')) {
    return { step: 'shortlist_ask_rank', message: getShortlistMessage('ask_rank') };
  }
  if (useExam && missing.includes('category')) {
    return { step: 'shortlist_ask_category', message: getShortlistMessage('ask_category') };
  }
  if (useExam && missing.includes('region')) {
    return { step: 'shortlist_ask_category', message: getShortlistMessage('ask_region'), focus: 'region' };
  }
  return null;
}

function curatedCatalogAsColleges(_profile = {}) {
  const {
    CURATED_MODERN_CATALOG,
  } = require('../../../constants/careerCounsellingV2ExploreModernColleges');

  return CURATED_MODERN_CATALOG.map((item) => ({
    college_name: item.name,
    college_address: '',
    district_enum: '',
    ownership: 'private',
    _curatedId: item.id,
    _curatedTags: item.tags || [],
    _curatedWhy: item.why || '',
    _curatedModel: item.model || null,
    branches: [
      {
        branch_name: 'Computer Science / Emerging Tech',
        branch_code: 'CSE',
        fee: null,
        cutoff: null,
      },
    ],
  }));
}

function shortlistIntroFor(profile = {}) {
  if (shouldUseExamEligibility(profile)) {
    return getShortlistMessage('shortlist_intro_predictor') || getShortlistMessage('shortlist_intro');
  }
  return getShortlistMessage('shortlist_intro');
}

function flattenTopShortlist(tiers, limit = SHORTLIST_PRESENT_LIMIT) {
  const flat = [
    ...(tiers.bestMatch || []),
    ...(tiers.strongAlternatives || []),
    ...(tiers.worthExploring || []),
  ];
  const seen = new Set();
  const out = [];
  for (const item of flat) {
    const key = String(item.collegeName || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function profileNarrativeSignals(profile = {}) {
  return [
    profile.careerPriority,
    profile.careerGoal,
    profile.preferredCourse,
    profile.preferredLearningStyle,
    profile.budgetPreference,
    ...(Array.isArray(profile.evaluationPriorities) ? profile.evaluationPriorities : []),
    ...(Array.isArray(profile.studentPriorities) ? profile.studentPriorities : []),
    ...(Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildCounselorMatchLine(item, profile = {}) {
  const name = String(item.collegeName || '');
  const firstWhy = String(item?.reasons?.why?.[0] || '').trim();
  const signals = profileNarrativeSignals(profile);
  const conciseWhy =
    firstWhy &&
    firstWhy.length <= 140 &&
    !/preferred course on profile|evaluation priorities|budget preference|location preference/i.test(
      firstWhy
    )
      ? firstWhy
      : '';

  if (/niat/i.test(name)) {
    if (/\bai\b|artificial intelligence|machine learning|projects?|industry|mentor|internship/.test(signals)) {
      return 'Best for students who want AI-first learning, projects, mentorship, and industry exposure.';
    }
    return conciseWhy || 'A strong option for students seeking practical, future-ready tech learning.';
  }

  if (/scaler/i.test(name)) {
    return 'Strong for software engineering students who want intensive mentorship and practical learning.';
  }
  if (/newton/i.test(name)) {
    return 'Good for project-based learning and employability-focused tech education.';
  }
  if (/plaksha/i.test(name)) {
    return 'Good for interdisciplinary, innovation-driven engineering.';
  }
  if (/upes/i.test(name)) {
    return 'Good for industry-aligned programs with practical exposure.';
  }

  if (conciseWhy) return conciseWhy;
  if (/placement/.test(signals)) {
    return 'A good fit for students prioritizing employability, mentoring, and practical outcomes.';
  }
  if (/project|hands.?on|skill/.test(signals)) {
    return 'A good fit for students who prefer project-based, applied learning.';
  }
  if (/startup|entrepreneur|innovation/.test(signals)) {
    return 'A good fit for students interested in innovation and entrepreneurial exposure.';
  }
  return 'A good match for your goals and the preferences you shared.';
}

function buildShortlistNarrative(colleges, profile = {}) {
  return colleges.map((item) => ({
    collegeName: item.collegeName,
    matchLine: buildCounselorMatchLine(item, profile),
  }));
}

function formatShortlistReply(tiers, confidence, profile = {}) {
  const colleges = flattenTopShortlist(tiers, SHORTLIST_PRESENT_LIMIT);
  const sections = [];

  if (!colleges.length) {
    sections.push(getShortlistMessage('no_eligibility') || 'No eligible colleges yet.');
  } else {
    const narrative = buildShortlistNarrative(colleges, profile);
    sections.push(getShortlistMessage('present_header') || shortlistIntroFor(profile));
    sections.push('');
    narrative.forEach((item) => {
      sections.push(`- **${item.collegeName}** — ${item.matchLine}`);
    });
    sections.push('');
  }

  sections.push(getShortlistMessage('ask_compare'));
  return sections.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').trim();
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
      _curatedId: c._curatedId || null,
      _curatedTags: Array.isArray(c._curatedTags) ? c._curatedTags : [],
      _curatedWhy: c._curatedWhy || null,
    })),
    recommendationReasons: reasons,
    shortlistNarrative: buildShortlistNarrative(flatten.slice(0, SHORTLIST_PRESENT_LIMIT), profile),
    recommendationConfidence: confidence,
    recommendationMatrixVersion: RECOMMENDATION_MATRIX_VERSION,
    eligibleCollegeCount: eligibleCount,
  };
}

async function generateAndPresent(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };

  // Normal counseling path: score curated new-age catalog (no exam/rank gate).
  if (!shouldUseExamEligibility(profile)) {
    return generateFromCuratedCatalog(ctx, analyticsMeta);
  }

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
    reply: formatShortlistReply(tiers, confidence, profile),
    context: {
      ...ctx,
      stage: STAGES.AI_SHORTLISTING,
      step: 'shortlist_ask_compare',
      profile: nextProfile,
      lastQuestionKey: 'compare_permission',
      shortlistCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    allowExtendedPrediction: true,
    keepIntact: true,
    skipLineCap: true,
    analytics: [
      { type: 'recommendation_generated' },
      { type: 'shortlist_completed' },
    ],
  };
}

function profileSignalBlob(profile = {}) {
  return [
    profile.careerGoal,
    profile.preferredCourse,
    profile.preferredLearningStyle,
    profile.careerPriority,
    profile.budgetPreference,
    ...(Array.isArray(profile.evaluationPriorities) ? profile.evaluationPriorities : []),
    ...(Array.isArray(profile.studentPriorities) ? profile.studentPriorities : []),
    ...(Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function justifiedCuratedBoost(college, profile = {}) {
  const blob = profileSignalBlob(profile);
  const tags = Array.isArray(college._curatedTags) ? college._curatedTags : [];
  let boost = 0;
  for (const tag of tags) {
    if (blob.includes(String(tag).replace(/_/g, ' ')) || blob.includes(String(tag))) {
      boost += 0.03;
    }
  }
  const id = String(college._curatedId || '');
  const name = String(college.college_name || college.collegeName || '');
  // NIAT earns a seat when AI / projects / industry signals are present — never forced #1.
  if (id === 'niat' || /\bniat\b/i.test(name)) {
    if (/\bai\b|artificial intelligence|machine learning|projects?|industry|mentor|internship|hands.?on/.test(blob)) {
      boost += 0.1;
    }
  }
  return Math.min(0.2, boost);
}

async function generateFromCuratedCatalog(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const colleges = curatedCatalogAsColleges(profile);
  let scored = scoreEligibleColleges(colleges, profile);
  scored = scored
    .map((row) => {
      const source = colleges.find((c) => c.college_name === row.collegeName) || {};
      const extra = justifiedCuratedBoost(source, profile);
      return {
        ...row,
        matchScore: Math.min(1, Number(row.matchScore || 0) + extra),
        _curatedId: source._curatedId || null,
        _curatedTags: Array.isArray(source._curatedTags) ? source._curatedTags : [],
        _curatedWhy: source._curatedWhy || null,
      };
    })
    .sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0));

  // Keep top SHORTLIST_PRESENT_LIMIT for presentation tiers
  const top = scored.slice(0, SHORTLIST_PRESENT_LIMIT);
  const tiers = {
    bestMatch: top.slice(0, 1),
    strongAlternatives: top.slice(1, 4),
    worthExploring: top.slice(4, SHORTLIST_PRESENT_LIMIT),
  };
  const confidence = calculateRecommendationConfidence(profile, tiers, colleges.length);
  const nextProfile = persistRecommendation(profile, tiers, confidence, colleges.length);
  nextProfile.shortlistSource = 'curated_new_age';

  logRecommendationGenerated({
    stage: STAGES.AI_SHORTLISTING,
    recommendedCount: nextProfile.recommendedColleges.length,
    recommendationConfidence: confidence,
    recommendationMatrixVersion: RECOMMENDATION_MATRIX_VERSION,
    source: 'curated_new_age',
    ...analyticsMeta,
  });

  logRecommendationViewed({
    stage: STAGES.AI_SHORTLISTING,
    recommendedCount: nextProfile.recommendedColleges.length,
    ...analyticsMeta,
  });

  logRecommendationConfidence({
    stage: STAGES.AI_SHORTLISTING,
    recommendationConfidence: confidence,
    ...analyticsMeta,
  });

  logShortlistCompleted({
    stage: STAGES.AI_SHORTLISTING,
    recommendationConfidence: confidence,
    source: 'curated_new_age',
    ...analyticsMeta,
  });

  return {
    reply: formatShortlistReply(tiers, confidence, profile),
    context: {
      ...ctx,
      stage: STAGES.AI_SHORTLISTING,
      step: 'shortlist_ask_compare',
      profile: nextProfile,
      lastQuestionKey: 'compare_permission',
      shortlistCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    allowExtendedPrediction: true,
    keepIntact: true,
    skipLineCap: true,
    analytics: [
      { type: 'recommendation_generated', source: 'curated_new_age' },
      { type: 'shortlist_completed' },
    ],
  };
}

async function continueAfterEligibilityFields(ctx, analyticsMeta) {
  if (!shouldUseExamEligibility(ctx.profile || {})) {
    return generateAndPresent(ctx, analyticsMeta);
  }

  const built = buildEligibilityRequest(ctx.profile || {});
  if (!built.ok) {
    const prompt = nextMissingPrompt(built.missing, ctx.profile || {});
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

  const nextCtx = {
    ...ctx,
    stage: STAGES.AI_SHORTLISTING,
    step: 'shortlist_validate',
    profile,
    shortlistStartedAt: new Date().toISOString(),
  };

  // Normal path: never ask exam/rank — generate from curated new-age catalog.
  if (!shouldUseExamEligibility(profile)) {
    return {
      reply: `${shortlistIntroFor(profile)}\n\n${getShortlistMessage('generating')}`,
      context: {
        ...nextCtx,
        step: 'shortlist_generate',
        lastQuestionKey: 'generate',
      },
      clearState: false,
      analytics: [{ type: 'shortlist_started', source: 'curated_new_age' }],
      _generateNow: true,
    };
  }

  const built = buildEligibilityRequest(profile);
  if (!built.ok) {
    const prompt = nextMissingPrompt(built.missing, profile);
    if (!prompt) {
      // Missing only non-exam fields we don't prompt for — try generate anyway.
      return {
        reply: `${shortlistIntroFor(profile)}\n\n${getShortlistMessage('generating_eligibility') || getShortlistMessage('generating')}`,
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
    return {
      reply: `${shortlistIntroFor(profile)}\n\n${prompt.message}`,
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
    reply: `${shortlistIntroFor(profile)}\n\n${getShortlistMessage('generating_eligibility') || getShortlistMessage('generating')}`,
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
      // Stage 7 = one WhatsApp bubble (shortlist + compare ask). No intro/generating split.
      return {
        reply: presented.reply,
        context: presented.context,
        clearState: false,
        keepIntact: true,
        skipLineCap: true,
        allowExtendedPrediction: true,
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
        autoCompareFullShortlist: true,
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
          profile: {
            ...(ctx.profile || {}),
            _shortlistDeclineCount: Number(ctx.profile?._shortlistDeclineCount || 0) + 1,
          },
        },
        clearState: false,
        parked: true,
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
      const {
        processSmartComparisonTurn,
      } = require('./careerCounsellingV2ComparisonEngine');
      return processSmartComparisonTurn(inbound, ctx, {
        startSmartComparison: true,
        autoCompareFullShortlist: true,
        analytics: analyticsMeta,
      });
    }
    // Soft-advance after one decline
    const {
      processSmartComparisonTurn,
    } = require('./careerCounsellingV2ComparisonEngine');
    const advanced = await processSmartComparisonTurn(inbound, ctx, {
      startSmartComparison: true,
      autoCompareFullShortlist: true,
      analytics: analyticsMeta,
    });
    return {
      ...advanced,
      skippedPhaseReason: 'user_declined_optional_gate',
      reply: `No problem — let’s compare what matters most next.\n\n${advanced.reply || ''}`.trim(),
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
  shouldUseExamEligibility,
  generateAndPresent,
};
