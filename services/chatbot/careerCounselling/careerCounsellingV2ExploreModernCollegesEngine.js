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

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function profileTagHaystack(profile = {}) {
  return normalize(
    [
      profile.preferredCourse,
      profile.careerGoal,
      profile.careerPriority,
      profile.learningStyle,
      Array.isArray(profile.studentPriorities) ? profile.studentPriorities.join(' ') : '',
      Array.isArray(profile.evaluationPriorities) ? profile.evaluationPriorities.join(' ') : '',
    ].join(' ')
  );
}

function scoreCuratedItem(item, hay) {
  let score = 0;
  for (const tag of item.tags || []) {
    if (hay.includes(tag)) score += 1;
  }
  return score;
}

/**
 * Stage 5 showcase: present catalog in pedagogical order (diverse modern models).
 * Do not popularity-rank or force NIAT first — light tag affinity only reorders
 * among equal-score peers while preserving catalog relative order as default.
 */
function selectCuratedInstitutions(profile = {}, limit = EXPLORE_PRESENT_LIMIT) {
  const hay = profileTagHaystack(profile);
  const scored = CURATED_MODERN_CATALOG.map((item, catalogIndex) => ({
    item,
    catalogIndex,
    score: scoreCuratedItem(item, hay),
  }));

  // Soft affinity only: items with any tag hit float above zero-hit items,
  // but keep catalog order within each band so NIAT is never auto-#1.
  scored.sort((a, b) => {
    const aHit = a.score > 0 ? 1 : 0;
    const bHit = b.score > 0 ? 1 : 0;
    if (aHit !== bHit) return bHit - aHit;
    return a.catalogIndex - b.catalogIndex;
  });

  return scored.slice(0, limit).map(({ item }) => ({
    name: item.name,
    why: item.why,
    source: 'curated',
    id: item.id,
    model: item.model || null,
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
  // cutoff/popularity rankings (those belong in later shortlisting).
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
    // Single WhatsApp bubble — skipLineCap alone was splitting Top-N into 6 replyParts.
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

async function advanceToPersonalization(inbound, ctx, analyticsMeta = {}) {
  const {
    startPersonalizedDiscovery,
  } = require('./careerCounsellingV2PersonalizationEngine');
  return startPersonalizedDiscovery(
    {
      ...ctx,
      profile: {
        ...(ctx.profile || {}),
        exploreModernCompleted: true,
      },
    },
    analyticsMeta
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
      const advanced = await advanceToPersonalization(inbound, ctx, analyticsMeta);
      return {
        ...advanced,
        reply: `${getExploreMessage('soft_decline_advance')}\n\n${advanced.reply || ''}`.trim(),
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
      const advanced = await advanceToPersonalization(inbound, ctx, analyticsMeta);
      return {
        ...advanced,
        reply: `${getExploreMessage('soft_decline_advance')}\n\n${advanced.reply || ''}`.trim(),
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
