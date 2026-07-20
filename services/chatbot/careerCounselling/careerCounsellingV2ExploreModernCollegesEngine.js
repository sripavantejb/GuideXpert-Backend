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

/**
 * Equal-representation top-N: priority-ranked first, then fill remaining catalog slots.
 */
function selectCuratedInstitutions(profile = {}, limit = EXPLORE_PRESENT_LIMIT) {
  const hay = profileTagHaystack(profile);
  const ranked = CURATED_MODERN_CATALOG.map((item) => ({
    item,
    score: scoreCuratedItem(item, hay),
  })).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const picked = [];
  const seen = new Set();
  for (const row of ranked) {
    if (picked.length >= limit) break;
    if (seen.has(row.item.id)) continue;
    seen.add(row.item.id);
    picked.push(row.item);
  }
  for (const item of CURATED_MODERN_CATALOG) {
    if (picked.length >= limit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    picked.push(item);
  }

  return picked.map((item) => ({
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

function mapEligibleToExplore(colleges, profile, limit = EXPLORE_PRESENT_LIMIT) {
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
  const lines = [getExploreMessage('present_header'), ''];
  const list = (institutions || []).slice(0, EXPLORE_PRESENT_LIMIT);
  if (!list.length) return getExploreMessage('no_items');
  list.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} — ${it.why}`);
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
      const eligibility = await retrieveEligibleColleges(profile, { limit: 40 });
      if (eligibility.ok && eligibility.colleges.length) {
        const mapped = mapEligibleToExplore(
          eligibility.colleges,
          profile,
          EXPLORE_PRESENT_LIMIT
        );
        if (mapped.length) {
          // Blend curated for equal representation when earlywave returns few
          if (mapped.length < EXPLORE_PRESENT_LIMIT) {
            const curated = selectCuratedInstitutions(profile, EXPLORE_PRESENT_LIMIT);
            const names = new Set(mapped.map((m) => normalize(m.name)));
            for (const c of curated) {
              if (mapped.length >= EXPLORE_PRESENT_LIMIT) break;
              if (names.has(normalize(c.name))) continue;
              mapped.push(c);
            }
          }
          return { institutions: mapped.slice(0, EXPLORE_PRESENT_LIMIT), source: 'earlywave' };
        }
      }
    } catch (_) {
      /* fall through to curated */
    }
  }
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
  const reply = `${getExploreMessage('intro')}\n\n${body}\n\n${getExploreMessage('ask_continue')}`;
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
