'use strict';

const {
  STAGES,
  EXPLORE_STEPS,
  EXPLORE_ENGINE_VERSION,
  CURATED_MODERN_CATALOG,
  getExploreMessage,
  isExplorePermissionYes,
  isExplorePermissionNo,
} = require('../../../constants/careerCounsellingV2ExploreModernColleges');
const { retrieveEligibleColleges } = require('./careerCounsellingV2EligibilityService');

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

function selectCuratedInstitutions(profile = {}, limit = 3) {
  const hay = profileTagHaystack(profile);
  const ranked = CURATED_MODERN_CATALOG.map((item) => ({
    item,
    score: scoreCuratedItem(item, hay),
  })).sort((a, b) => b.score - a.score);

  const picked = ranked.filter((r) => r.score > 0).slice(0, limit);
  const base = picked.length ? picked : ranked.slice(0, limit);
  return base.map(({ item }) => ({
    name: item.name,
    why: item.why,
    source: 'curated',
    id: item.id,
  }));
}

function modernLeanScore(college, profile = {}) {
  const hay = normalize(
    `${college?.college_name || ''} ${college?.branches?.[0]?.branch_name || ''}`
  );
  const style = normalize(profile.learningStyle || '');
  const priorities = Array.isArray(profile.evaluationPriorities)
    ? profile.evaluationPriorities.map(normalize)
    : [];
  let score = 0.4;
  if (/computer|cse|it|ai|data|information|software/.test(hay)) score += 0.2;
  if (/hands|project|industry|mentor/.test(style)) score += 0.15;
  if (priorities.some((p) => /project|industry|mentor|curriculum|placement/.test(p))) {
    score += 0.15;
  }
  return score;
}

function mapEligibleToExplore(colleges, profile, limit = 3) {
  const scored = (colleges || [])
    .map((c) => ({
      college: c,
      score: modernLeanScore(c, profile),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ college }) => {
    const branch = Array.isArray(college.branches) ? college.branches[0] : null;
    const name = branch?.branch_name
      ? `${college.college_name} — ${branch.branch_name}`
      : college.college_name;
    return {
      name,
      why: getExploreMessage('why_fallback'),
      source: 'earlywave',
      collegeName: college.college_name,
    };
  });
}

function formatExplorePresent(institutions) {
  const lines = [getExploreMessage('present_header')];
  const list = (institutions || []).slice(0, 3);
  if (!list.length) return getExploreMessage('no_items');
  list.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name}`);
    lines.push(it.why);
  });
  return lines.join('\n');
}

function hasEligibilitySlots(profile = {}) {
  const exam = profile.exam || profile.entranceExam;
  const rank = profile.rank != null ? Number(profile.rank) : null;
  return Boolean(exam) && Number.isFinite(rank) && rank > 0;
}

async function resolveExploreInstitutions(profile = {}) {
  if (hasEligibilitySlots(profile)) {
    try {
      const eligibility = await retrieveEligibleColleges(profile, { limit: 30 });
      if (eligibility.ok && eligibility.colleges.length) {
        const mapped = mapEligibleToExplore(eligibility.colleges, profile, 3);
        if (mapped.length) {
          return { institutions: mapped, source: 'earlywave' };
        }
      }
    } catch (_) {
      /* fall through to curated */
    }
  }
  return {
    institutions: selectCuratedInstitutions(profile, 3),
    source: 'curated',
  };
}

function startExploreModernColleges(ctx = {}, analyticsMeta = {}) {
  return {
    reply: `${getExploreMessage('intro')}\n\n${getExploreMessage('ask_continue')}`,
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
    phaseGateComplete: false,
    analytics: [{ type: 'explore_modern_started', ...analyticsMeta }],
  };
}

async function presentExploreInstitutions(ctx, analyticsMeta = {}) {
  const resolved = await resolveExploreInstitutions(ctx.profile || {});
  const body = formatExplorePresent(resolved.institutions);
  const reply = `${body}\n\n${getExploreMessage('ask_continue')}`;
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
    allowExtendedPrediction: true,
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

async function advanceToShortlisting(inbound, ctx, analyticsMeta = {}) {
  const { processAiShortlistingTurn } = require('./careerCounsellingV2ShortlistingEngine');
  return processAiShortlistingTurn(inbound, ctx, {
    startAiShortlisting: true,
    analytics: analyticsMeta,
  });
}

async function processExploreModernCollegesTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (opts.startExploreModernColleges || ctx.step === 'explore_modern_placeholder') {
    const started = startExploreModernColleges(ctx, analyticsMeta);
    // Immediately present on same turn after permission from personalization
    if (opts.presentImmediately || isExplorePermissionYes(inbound) || opts.fromPersonalization) {
      return presentExploreInstitutions(started.context, analyticsMeta);
    }
    return started;
  }

  if (ctx.stage === STAGES.AI_SHORTLISTING || String(ctx.step || '').startsWith('shortlist_')) {
    return advanceToShortlisting(inbound, ctx, analyticsMeta);
  }

  if (ctx.step === 'explore_intro') {
    if (isExplorePermissionNo(inbound)) {
      // Soft-advance into shortlisting with justification
      const advanced = await advanceToShortlisting(inbound, ctx, analyticsMeta);
      return {
        ...advanced,
        reply: `${getExploreMessage('soft_decline_advance')}\n\n${advanced.reply || ''}`.trim(),
        skippedPhaseReason: 'user_declined_optional_gate',
      };
    }
    return presentExploreInstitutions(ctx, analyticsMeta);
  }

  if (ctx.step === 'explore_present' || ctx.step === 'explore_ask_continue') {
    if (isExplorePermissionYes(inbound) || /shortlist|continue|next|ready/i.test(inbound)) {
      return advanceToShortlisting(inbound, ctx, analyticsMeta);
    }
    if (isExplorePermissionNo(inbound)) {
      const advanced = await advanceToShortlisting(inbound, {
        ...ctx,
        profile: {
          ...(ctx.profile || {}),
          skippedPhaseReason: 'user_declined_optional_gate',
        },
      }, analyticsMeta);
      return {
        ...advanced,
        reply: `${getExploreMessage('soft_decline_advance')}\n\n${advanced.reply || ''}`.trim(),
        skippedPhaseReason: 'user_declined_optional_gate',
      };
    }
    // Why questions — short ack then re-ask continue
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

  // Unknown step under explore stage — present then continue
  if (ctx.stage === STAGES.EXPLORE_MODERN_COLLEGES) {
    return presentExploreInstitutions(ctx, analyticsMeta);
  }

  return startExploreModernColleges(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  EXPLORE_STEPS,
  EXPLORE_ENGINE_VERSION,
  startExploreModernColleges,
  processExploreModernCollegesTurn,
  resolveExploreInstitutions,
  selectCuratedInstitutions,
  formatExplorePresent,
};
