'use strict';

const {
  STAGES,
  COMPARISON_STEPS,
  COMPARISON_ENGINE_VERSION,
  getCompareMessage,
  COMPARE_QA,
} = require('../../../constants/careerCounsellingV2Comparison');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  isComparePermissionYes,
  isComparePermissionNo,
  isCompareQuestion,
} = require('./careerCounsellingV2ComparisonParser');
const { runComparison } = require('./careerCounsellingV2ComparisonCore');
const {
  logComparisonStarted,
  logCollegesSelectedForComparison,
  logComparisonDimensionViewed,
  logComparisonCompleted,
  logFollowupQuestionAsked,
  logDecisionConfidenceCalculated,
  logPreferredCollegeIdentified,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function answerCompareQuestion(text) {
  const t = String(text || '').trim();
  for (const entry of COMPARE_QA) {
    if (entry.patterns.some((re) => re.test(t))) return entry.answer;
  }
  return null;
}

function shortCollegeLabel(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'College';
  if (/\bniat\b/i.test(raw)) return 'NIAT';
  if (/scaler/i.test(raw)) return 'Scaler';
  if (/newton/i.test(raw)) return 'Newton';
  if (/plaksha/i.test(raw)) return 'Plaksha';
  if (/upes/i.test(raw)) return 'UPES';
  if (/kalvium/i.test(raw)) return 'Kalvium';
  if (/srm/i.test(raw)) return 'SRM';
  if (/manipal/i.test(raw)) return 'Manipal';
  return raw.length > 18 ? `${raw.slice(0, 16)}…` : raw;
}

function resolveCuratedMeta(college = {}) {
  if (
    (Array.isArray(college._curatedTags) && college._curatedTags.length) ||
    college._curatedWhy ||
    college._curatedId
  ) {
    return {
      id: college._curatedId || null,
      tags: Array.isArray(college._curatedTags) ? college._curatedTags : [],
      why: college._curatedWhy || '',
    };
  }
  try {
    const {
      CURATED_MODERN_CATALOG,
    } = require('../../../constants/careerCounsellingV2ExploreModernColleges');
    const name = String(college.collegeName || '').toLowerCase();
    const hit = CURATED_MODERN_CATALOG.find(
      (item) =>
        String(item.name || '').toLowerCase() === name ||
        name.includes(String(item.id || '').toLowerCase()) ||
        String(item.name || '')
          .toLowerCase()
          .includes(name.split('(')[0].trim())
    );
    if (hit) {
      return {
        id: hit.id || null,
        tags: Array.isArray(hit.tags) ? hit.tags : [],
        why: hit.why || '',
      };
    }
  } catch (_err) {
    // Catalog optional for predictor-only shortlists.
  }
  return { id: null, tags: [], why: '' };
}

function stars(n) {
  const count = Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
  return '⭐'.repeat(count);
}

function scoreFactor(tags, id, factorId) {
  const has = (x) => tags.includes(x);
  const isNiat = id === 'niat' || tags.includes('ai');
  switch (factorId) {
    case 'ai':
      if (has('ai') || isNiat) return 5;
      if (has('software') || has('cse')) return 4;
      if (has('innovation') || has('curriculum')) return 3;
      return 3;
    case 'projects':
      if (has('projects') && has('industry')) return 5;
      if (has('projects') || has('hands_on')) return 4;
      if (has('industry')) return 3;
      return 3;
    case 'mentorship':
      if (has('mentoring') && (has('industry') || isNiat)) return 5;
      if (has('mentoring')) return 4;
      return 3;
    case 'internships':
      if (has('internships') && has('placements')) return 5;
      if (has('internships') || has('placements')) return 4;
      if (has('industry')) return 3;
      return 3;
    case 'career':
      if ((has('placements') || has('industry')) && (has('mentoring') || has('internships'))) return 5;
      if (has('placements') || has('industry')) return 4;
      return 3;
    case 'portfolio':
      if (has('projects') && has('hands_on')) return 5;
      if (has('projects') || has('hands_on')) return 4;
      return 3;
    default:
      return 3;
  }
}

const COMPARE_FACTORS = Object.freeze([
  Object.freeze({ id: 'ai', label: 'AI-focused curriculum' }),
  Object.freeze({ id: 'projects', label: 'Industry projects' }),
  Object.freeze({ id: 'mentorship', label: 'Mentorship' }),
  Object.freeze({ id: 'internships', label: 'Internship readiness' }),
  Object.freeze({ id: 'career', label: 'Career preparation' }),
  Object.freeze({ id: 'portfolio', label: 'Portfolio building' }),
]);

function formatComparisonReply(selectedColleges, profile = {}) {
  const enriched = selectedColleges.map((college) => {
    const meta = resolveCuratedMeta(college);
    return { ...college, _curatedId: meta.id, _curatedTags: meta.tags, _curatedWhy: meta.why };
  });

  const lines = [getCompareMessage('comparison_header'), ''];
  for (const factor of COMPARE_FACTORS) {
    lines.push(`*${factor.label}*`);
    const parts = enriched.map((college) => {
      const score = scoreFactor(college._curatedTags || [], college._curatedId, factor.id);
      return `${shortCollegeLabel(college.collegeName)} ${stars(score)}`;
    });
    lines.push(parts.join(' · '));
    lines.push('');
  }

  const lead =
    profile.preferredCollege ||
    enriched[0]?.collegeName ||
    'your top shortlisted option';
  lines.push(getCompareMessage('comparison_summary', shortCollegeLabel(lead)));
  lines.push('');
  lines.push(getCompareMessage('ask_recommendation'));
  return lines.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').trim();
}

function answerFollowupFromContext(inbound, ctx) {
  const canned = answerCompareQuestion(inbound);
  if (canned) return canned;

  const profile = ctx.profile || {};
  const compared = Array.isArray(profile.comparedColleges) ? profile.comparedColleges : [];
  const summary = profile.comparisonSummary || '';
  const preferred = profile.preferredCollege;
  const reasons = Array.isArray(profile.decisionReasons) ? profile.decisionReasons : [];
  const t = String(inbound || '').toLowerCase();

  if (/\bfee|budget|cost|afford/i.test(t)) {
    return [
      `Fees: weighed against your budget (${profile.budgetPreference || 'as shared'}).`,
      preferred ? `Current lean: ${preferred}.` : '',
      'Confirm exact fees + scholarships before deciding.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (/\blocation|city|hostel|relocat/i.test(t)) {
    return `Location preference: ${profile.preferredLocation || 'open'} (relocation: ${profile.relocationPreference || 'n/a'}). Want to re-pick with a different location emphasis?`;
  }

  if (/\bverdict|prefer|which (one|college)|best (fit|for me)/i.test(t)) {
    return [
      preferred ? `Current lean: ${preferred}.` : 'Pick colleges to compare first.',
      reasons[0] || '',
      'Decision support — not an admission call.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (compared.length > 0) {
    return [
      `We compared: ${compared.map((c) => c.collegeName || c).join(', ')}.`,
      summary ? `Summary: ${String(summary).slice(0, 280)}` : '',
      getCompareMessage('question_fallback'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return getCompareMessage('question_fallback');
}

function persistComparison(profile, selectedColleges, result) {
  return {
    ...profile,
    comparedColleges: selectedColleges.map((c) => ({
      collegeName: c.collegeName,
      branchName: c.branchName || null,
      tier: c.tier || null,
    })),
    comparisonDimensions: result.dimensions.map((d) => d.id),
    comparisonSummary: result.verdict.verdict,
    preferredCollege: result.verdict.preferredCollege,
    decisionConfidence: result.decisionConfidence,
    decisionReasons: result.verdict.decisionReasons,
    comparisonEngineVersion: COMPARISON_ENGINE_VERSION,
  };
}

function startSmartComparison(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const recommended = Array.isArray(profile.recommendedColleges)
    ? profile.recommendedColleges
    : [];

  if (recommended.length < 2) {
    return {
      reply: getCompareMessage('no_shortlist'),
      context: {
        ...ctx,
        stage: STAGES.SMART_COMPARISON,
        step: 'compare_select',
        profile,
      },
      clearState: false,
      analytics: [{ type: 'comparison_no_shortlist' }],
    };
  }

  logComparisonStarted({
    stage: STAGES.SMART_COMPARISON,
    shortlistCount: recommended.length,
    ...analyticsMeta,
  });

  const selected = recommended.slice(0, 5);
  if (ctx.autoCompareFullShortlist) {
    return presentComparison({ ...ctx, profile }, selected, analyticsMeta);
  }
  return {
    reply: `${getCompareMessage('compare_intro')}\n\n${getCompareMessage('ask_recommendation')}`,
    context: {
      ...ctx,
      stage: STAGES.SMART_COMPARISON,
      step: 'compare_ask_recommendation',
      profile,
      lastQuestionKey: 'compare_recommendation',
      comparisonStartedAt: new Date().toISOString(),
    },
    clearState: false,
    // College list + select prompt must stay intact — line-cap was dropping numbered choices.
    keepIntact: true,
    skipLineCap: true,
    analytics: [{ type: 'comparison_started' }],
  };
}

function presentComparison(ctx, selectedColleges, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const result = runComparison(profile, selectedColleges);
  const nextProfile = persistComparison(profile, selectedColleges, result);

  logCollegesSelectedForComparison({
    stage: STAGES.SMART_COMPARISON,
    colleges: selectedColleges.map((c) => c.collegeName),
    count: selectedColleges.length,
    ...analyticsMeta,
  });

  for (const dim of result.dimensions) {
    logComparisonDimensionViewed({
      stage: STAGES.SMART_COMPARISON,
      dimension: dim.id,
      ...analyticsMeta,
    });
  }

  logDecisionConfidenceCalculated({
    stage: STAGES.SMART_COMPARISON,
    decisionConfidence: result.decisionConfidence,
    ...analyticsMeta,
  });

  logPreferredCollegeIdentified({
    stage: STAGES.SMART_COMPARISON,
    preferredCollege: result.verdict.preferredCollege,
    ...analyticsMeta,
  });

  logComparisonCompleted({
    stage: STAGES.SMART_COMPARISON,
    preferredCollege: result.verdict.preferredCollege,
    decisionConfidence: result.decisionConfidence,
    ...analyticsMeta,
  });

  logProfileUpdated({
    stage: STAGES.SMART_COMPARISON,
    fieldsUpdated: [
      'comparedColleges',
      'comparisonDimensions',
      'comparisonSummary',
      'preferredCollege',
      'decisionConfidence',
      'decisionReasons',
    ],
    ...analyticsMeta,
  });

  return {
    reply: formatComparisonReply(selectedColleges, nextProfile),
    context: {
      ...ctx,
      stage: STAGES.SMART_COMPARISON,
      step: 'compare_ask_recommendation',
      profile: nextProfile,
      lastQuestionKey: 'compare_recommendation',
      lastComparisonResult: {
        dimensions: result.dimensions.map((d) => d.id),
        preferredCollege: result.verdict.preferredCollege,
        decisionConfidence: result.decisionConfidence,
      },
      comparisonCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    // Full comparison table + best-fit prompt must remain in one bubble.
    keepIntact: true,
    skipLineCap: true,
    analytics: [
      { type: 'comparison_completed' },
      { type: 'preferred_college_identified' },
    ],
  };
}

async function processSmartComparisonTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startSmartComparison ||
    ctx.step === 'comparison_placeholder' ||
    (ctx.stage === STAGES.SMART_COMPARISON &&
      !COMPARISON_STEPS.includes(ctx.step) &&
      ctx.step !== 'concern_resolution_placeholder' &&
      !String(ctx.step || '').startsWith('concern_') &&
      ctx.step !== 'phase9_personalized_recommendation_placeholder' &&
      !String(ctx.step || '').startsWith('phase9_') &&
      ctx.step !== 'phase10_future_path_vision_placeholder' &&
      !String(ctx.step || '').startsWith('vision_') &&
      !String(ctx.step || '').startsWith('hesitation_') &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      ctx.step !== 'phase11_final_decision_hesitation_placeholder' &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      !String(ctx.step || '').startsWith('invite_') &&
      ctx.step !== 'conversation_complete')
  ) {
    return startSmartComparison(
      { ...ctx, autoCompareFullShortlist: opts.autoCompareFullShortlist === true },
      analyticsMeta
    );
  }

  if (
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
      (ctx.step.startsWith('concern_') ||
        ctx.step.startsWith('phase9_') ||
        ctx.step.startsWith('vision_') ||
        ctx.step.startsWith('hesitation_') ||
        ctx.step.startsWith('counsel_rec_') ||
        ctx.step.startsWith('booking_') ||
        ctx.step.startsWith('invite_')))
  ) {
    const {
      processConcernResolutionTurn,
    } = require('./careerCounsellingV2ConcernResolutionEngine');
    return processConcernResolutionTurn(inbound, ctx, {
      startConcernResolution:
        ctx.step === 'concern_resolution_placeholder' ||
        opts.startConcernResolution ||
        (ctx.stage === STAGES.CONCERN_RESOLUTION_PLACEHOLDER &&
          !String(ctx.step || '').startsWith('concern_')),
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
      reply: `${getCompareMessage('greeting_mid')}\n\n${getCompareMessage('awaiting_ack_nudge')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'compare_select') {
    const selected = (ctx.profile?.recommendedColleges || []).slice(0, 5);
    return presentComparison(ctx, selected, analyticsMeta);
  }

  if (ctx.step === 'compare_ask_recommendation' || ctx.step === 'compare_present') {
    if (isComparePermissionYes(inbound)) {
      const {
        startPhase9PersonalizedRecommendation,
      } = require('./careerCounsellingV2PersonalizedRecommendationEngine');
      return {
        ...startPhase9PersonalizedRecommendation(ctx, analyticsMeta),
        keepIntact: true,
      };
    }
    if (isComparePermissionNo(inbound)) {
      return {
        reply: 'No problem. Say Yes whenever you want a best-fit recommendation.',
        context: {
          ...ctx,
          step: 'compare_ask_recommendation',
          lastQuestionKey: 'compare_recommendation',
        },
        clearState: false,
        parked: true,
        analytics: [],
      };
    }
    if (isCompareQuestion(inbound) || /\bconcern|worried|doubt|not sure|fees|location|hostel\b/i.test(inbound)) {
      const {
        processConcernResolutionTurn,
      } = require('./careerCounsellingV2ConcernResolutionEngine');
      logFollowupQuestionAsked({
        stage: STAGES.SMART_COMPARISON,
        questionPreview: inbound.slice(0, 80),
        ...analyticsMeta,
      });
      return processConcernResolutionTurn(inbound, ctx, {
        startConcernResolution: true,
        analytics: analyticsMeta,
      });
    }

    return {
      reply: getCompareMessage('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startSmartComparison(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  COMPARISON_STEPS,
  startSmartComparison,
  processSmartComparisonTurn,
  formatComparisonReply,
  presentComparison,
};
