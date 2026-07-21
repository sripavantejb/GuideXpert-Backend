'use strict';

const {
  STAGES,
  EXPLORE_STEPS,
  EXPLORE_ENGINE_VERSION,
  EXPLORE_PRESENT_LIMIT,
  CURATED_MODERN_CATALOG,
  getExploreMessage,
  isExplorePermissionYes,
  isExplorePermissionNo,
} = require('../../../constants/careerCounsellingV2ExploreModernColleges');

/**
 * Stage 5 showcase: fixed curated order of ALL genuine new-age institutions.
 * Always full catalog (10). No pagination. No Top-N preview/scoring here.
 * NIAT is mid-list by design, never forced first.
 */
function selectCuratedInstitutions(_profile = {}, limit = EXPLORE_PRESENT_LIMIT) {
  return CURATED_MODERN_CATALOG.slice(0, limit).map((item) => ({
    name: item.name,
    why: item.why,
    source: 'curated',
    id: item.id,
    model: item.model || null,
    tags: item.tags || [],
  }));
}

function formatExplorePresent(institutions) {
  const header = getExploreMessage('present_header');
  const lines = header ? [header, ''] : [];
  const list = (institutions || []).slice(0, EXPLORE_PRESENT_LIMIT);
  if (!list.length) return getExploreMessage('no_items');
  list.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} — ${it.why}`);
  });
  return lines.join('\n');
}

async function resolveExploreInstitutions(profile = {}) {
  // Stage 5 is an educational new-age showcase — never replace with Earlywave
  // cutoff/popularity rankings (those belong in Stage 7 shortlisting).
  return {
    institutions: selectCuratedInstitutions(profile, EXPLORE_PRESENT_LIMIT),
    source: 'curated',
  };
}

function startExploreModernColleges(ctx = {}, analyticsMeta = {}) {
  return {
    reply: getExploreMessage('intro'),
    context: {
      ...ctx,
      flow: ctx.flow || 'career_counselling_v2',
      version: 2,
      stage: STAGES.EXPLORE_MODERN_COLLEGES,
      step: 'explore_intro',
      lastQuestionKey: 'explore_intro',
      exploreEngineVersion: EXPLORE_ENGINE_VERSION,
    },
    clearState: false,
    skipLineCap: true,
    phaseGateComplete: false,
    analytics: [{ type: 'explore_modern_started', ...analyticsMeta }],
  };
}

async function presentExploreInstitutions(ctx, analyticsMeta = {}) {
  const resolved = await resolveExploreInstitutions(ctx.profile || {});
  const body = formatExplorePresent(resolved.institutions);
  const intro = getExploreMessage('intro');
  const ask = getExploreMessage('ask_continue');
  const reply = [intro, body, ask].filter((part) => String(part || '').trim()).join('\n\n');
  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.EXPLORE_MODERN_COLLEGES,
      step: 'explore_ask_continue',
      lastQuestionKey: 'explore_continue',
      profile: {
        ...(ctx.profile || {}),
        exploreModernInstitutions: resolved.institutions,
        exploreModernSource: resolved.source,
        exploreModernCompletedAt: new Date().toISOString(),
      },
    },
    clearState: false,
    // Single WhatsApp bubble — never fragment Stage 5 into multiple messages.
    keepIntact: true,
    skipLineCap: true,
    educationalContent: true,
    phaseGateComplete: true,
    analytics: [
      {
        type: 'explore_modern_presented',
        source: resolved.source,
        count: resolved.institutions.length,
        ...analyticsMeta,
      },
    ],
  };
}

/**
 * Stage 5 YES → Stage 6 Personalized Discovery only.
 * No Top-3 / Top-5 recommendations. No college scoring here.
 */
async function advanceToPersonalization(inbound, ctx, analyticsMeta = {}, opts = {}) {
  const {
    startPersonalizedDiscoveryFromExplore,
  } = require('./careerCounsellingV2PersonalizationEngine');
  const profile = {
    ...(ctx.profile || {}),
    exploreModernCompleted: true,
  };
  // Clear any legacy preview fields so Stage 6 never recommends early.
  delete profile.stage5PreviewInstitutions;

  return startPersonalizedDiscoveryFromExplore(
    { ...ctx, profile },
    analyticsMeta,
    { softDeclinePrefix: opts.softDeclinePrefix || '' }
  );
}

async function processExploreModernCollegesTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (opts.startExploreModernColleges || ctx.step === 'explore_modern_placeholder') {
    const started = startExploreModernColleges(ctx, analyticsMeta);
    if (
      opts.presentImmediately ||
      isExplorePermissionYes(inbound) ||
      opts.fromPersonalization ||
      opts.fromEvaluation
    ) {
      return presentExploreInstitutions(started.context, analyticsMeta);
    }
    return started;
  }

  if (ctx.stage === STAGES.AI_SHORTLISTING || String(ctx.step || '').startsWith('shortlist_')) {
    const { processAiShortlistingTurn } = require('./careerCounsellingV2ShortlistingEngine');
    return processAiShortlistingTurn(inbound, ctx, {
      startAiShortlisting: true,
      analytics: analyticsMeta,
    });
  }

  if (
    ctx.stage === STAGES.PERSONALIZED_DISCOVERY ||
    String(ctx.step || '').startsWith('pers_')
  ) {
    const {
      processPersonalizedDiscoveryTurn,
    } = require('./careerCounsellingV2PersonalizationEngine');
    return processPersonalizedDiscoveryTurn(inbound, ctx, { analytics: analyticsMeta });
  }

  if (ctx.step === 'explore_intro') {
    if (isExplorePermissionNo(inbound)) {
      const advanced = await advanceToPersonalization(inbound, ctx, analyticsMeta, {
        softDeclinePrefix: getExploreMessage('soft_decline_advance'),
      });
      return {
        ...advanced,
        skippedPhaseReason: 'user_declined_optional_gate',
      };
    }
    return presentExploreInstitutions(ctx, analyticsMeta);
  }

  if (ctx.step === 'explore_present' || ctx.step === 'explore_ask_continue') {
    if (
      isExplorePermissionYes(inbound) ||
      /shortlist|continue|next|ready|narrow|personalize/i.test(inbound)
    ) {
      return advanceToPersonalization(inbound, ctx, analyticsMeta);
    }
    if (isExplorePermissionNo(inbound)) {
      const advanced = await advanceToPersonalization(inbound, ctx, analyticsMeta, {
        softDeclinePrefix: getExploreMessage('soft_decline_advance'),
      });
      return {
        ...advanced,
        skippedPhaseReason: 'user_declined_optional_gate',
      };
    }
    if (/\bwhy\b|\bfit\b|\bworth\b/i.test(inbound)) {
      const institutions = ctx.profile?.exploreModernInstitutions || [];
      const first = institutions[0];
      const why = first?.why || getExploreMessage('why_fallback');
      return {
        reply: `${why}\n\n${getExploreMessage('ask_continue')}`,
        context: ctx,
        clearState: false,
        keepIntact: true,
        analytics: [],
      };
    }
    return {
      reply: getExploreMessage('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.stage === STAGES.EXPLORE_MODERN_COLLEGES) {
    return presentExploreInstitutions(ctx, analyticsMeta);
  }

  return startExploreModernColleges(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  EXPLORE_STEPS,
  EXPLORE_ENGINE_VERSION,
  EXPLORE_PRESENT_LIMIT,
  startExploreModernColleges,
  processExploreModernCollegesTurn,
  resolveExploreInstitutions,
  selectCuratedInstitutions,
  formatExplorePresent,
};
