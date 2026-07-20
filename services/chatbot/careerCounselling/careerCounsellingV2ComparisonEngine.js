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
  formatShortlistChoices,
  parseCollegeSelection,
  isCompareContinue,
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

function formatCollegeCompareBlock(card) {
  const title = card.branchName
    ? `${card.collegeName} — ${card.branchName}`
    : card.collegeName;
  const lines = [`*${title}*`, 'Why it fits:'];
  for (const w of card.whyFits.slice(0, 2)) lines.push(`✅ ${w}`);
  lines.push('Watch-outs:');
  for (const c of card.consider.slice(0, 2)) lines.push(`• ${c}`);
  return lines.join('\n');
}

function formatComparisonReply(result) {
  const sections = [getCompareMessage('comparison_header'), ''];

  sections.push(getCompareMessage('dimensions_header'));
  for (const dim of result.dimensions) {
    sections.push(`- ${dim.label}`);
  }
  sections.push('');

  for (const card of result.cards) {
    sections.push(formatCollegeCompareBlock(card));
    sections.push('');
  }

  sections.push(getCompareMessage('tradeoffs_header'));
  for (const t of result.tradeoffs) {
    sections.push(`- ${t}`);
  }
  sections.push('');

  sections.push(getCompareMessage('verdict_header'));
  sections.push(result.verdict.verdict);
  sections.push('');
  sections.push(getCompareMessage('invite_questions'));

  return sections.join('\n').trim();
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

  const choices = formatShortlistChoices(recommended);
  return {
    reply: `${getCompareMessage('compare_intro')}\n\n${getCompareMessage('ask_select')}\n\n${choices}`,
    context: {
      ...ctx,
      stage: STAGES.SMART_COMPARISON,
      step: 'compare_select',
      profile,
      lastQuestionKey: 'compare_select',
      comparisonStartedAt: new Date().toISOString(),
    },
    clearState: false,
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
    reply: formatComparisonReply(result),
    context: {
      ...ctx,
      stage: STAGES.SMART_COMPARISON,
      step: 'compare_invite_questions',
      profile: nextProfile,
      lastQuestionKey: 'compare_questions',
      lastComparisonResult: {
        dimensions: result.dimensions.map((d) => d.id),
        preferredCollege: result.verdict.preferredCollege,
        decisionConfidence: result.decisionConfidence,
      },
      comparisonCompletedAt: new Date().toISOString(),
    },
    clearState: false,
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
    return startSmartComparison(ctx, analyticsMeta);
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
    const recommended = ctx.profile?.recommendedColleges || [];
    const parsed = parseCollegeSelection(inbound, recommended);
    if (!parsed) {
      const choices = formatShortlistChoices(recommended);
      return {
        reply: `${getCompareMessage('select_clarify')}\n\n${choices}`,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    return presentComparison(ctx, parsed.colleges, analyticsMeta);
  }

  if (ctx.step === 'compare_invite_questions' || ctx.step === 'compare_present') {
    if (isCompareContinue(inbound) && !/\?/.test(inbound)) {
      return {
        reply: getCompareMessage('ask_continue'),
        context: {
          ...ctx,
          step: 'compare_ask_continue',
          lastQuestionKey: 'compare_continue',
        },
        clearState: false,
        analytics: [],
      };
    }

    if (isCompareQuestion(inbound) || inbound.length >= 4) {
      logFollowupQuestionAsked({
        stage: STAGES.SMART_COMPARISON,
        questionPreview: inbound.slice(0, 80),
        ...analyticsMeta,
      });
      const answer = answerFollowupFromContext(inbound, ctx);
      return {
        reply: `${answer}\n\n${getCompareMessage('invite_questions')}`,
        context: ctx,
        clearState: false,
        analytics: [{ type: 'followup_question_asked' }],
      };
    }

    return {
      reply: getCompareMessage('invite_questions'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'compare_ask_continue') {
    if (isComparePermissionYes(inbound) || isCompareContinue(inbound)) {
      const {
        processConcernResolutionTurn,
      } = require('./careerCounsellingV2ConcernResolutionEngine');
      return processConcernResolutionTurn(inbound, ctx, {
        startConcernResolution: true,
        analytics: analyticsMeta,
      });
    }
    if (isComparePermissionNo(inbound)) {
      const declineCount = Number(ctx.profile?._compareDeclineCount || 0) + 1;
      if (declineCount >= 2) {
        const {
          processConcernResolutionTurn,
        } = require('./careerCounsellingV2ConcernResolutionEngine');
        const advanced = await processConcernResolutionTurn(inbound, ctx, {
          startConcernResolution: true,
          analytics: analyticsMeta,
        });
        return {
          ...advanced,
          skippedPhaseReason: 'user_declined_optional_gate',
          reply: `Okay — let’s clear any remaining concerns next.\n\n${advanced.reply || ''}`.trim(),
        };
      }
      return {
        reply: getCompareMessage('invite_questions'),
        context: {
          ...ctx,
          step: 'compare_invite_questions',
          lastQuestionKey: 'compare_questions',
          profile: {
            ...(ctx.profile || {}),
            _compareDeclineCount: declineCount,
          },
        },
        clearState: false,
        parked: true,
        analytics: [],
      };
    }
    if (isCompareQuestion(inbound)) {
      logFollowupQuestionAsked({
        stage: STAGES.SMART_COMPARISON,
        questionPreview: inbound.slice(0, 80),
        ...analyticsMeta,
      });
      const answer = answerFollowupFromContext(inbound, ctx);
      return {
        reply: `${answer}\n\n${getCompareMessage('continue_clarify')}`,
        context: ctx,
        clearState: false,
        analytics: [{ type: 'followup_question_asked' }],
      };
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
