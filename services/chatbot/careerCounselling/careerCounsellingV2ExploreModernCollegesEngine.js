'use strict';

const {
  STAGES,
  EXPLORE_STEPS,
  EXPLORE_ENGINE_VERSION,
  EXPLORE_PRESENT_LIMIT,
  STAGE5_PREVIEW_LIMIT,
  CURATED_MODERN_CATALOG,
  getExploreMessage,
  isExplorePermissionYes,
  isExplorePermissionNo,
} = require('../../../constants/careerCounsellingV2ExploreModernColleges');

/**
 * Stage 5 showcase: fixed curated order of genuine new-age institutions.
 * No popularity ranking; NIAT is mid-list by design, never forced first.
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

function profileSignalTags(profile = {}) {
  const blobs = [
    profile.careerGoal,
    profile.preferredCourse,
    profile.preferredLearningStyle,
    profile.careerPriority,
    ...(Array.isArray(profile.evaluationPriorities) ? profile.evaluationPriorities : []),
    ...(Array.isArray(profile.studentPriorities) ? profile.studentPriorities : []),
    ...(Array.isArray(profile.biggestConcerns) ? profile.biggestConcerns : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const tags = new Set();
  if (/\bai\b|artificial intelligence|machine learning/.test(blobs)) tags.add('ai');
  if (/project|hands.?on|practical|applied/.test(blobs)) {
    tags.add('projects');
    tags.add('hands_on');
  }
  if (/internship|industry|placement|employ/.test(blobs)) {
    tags.add('industry');
    tags.add('internships');
    tags.add('placements');
  }
  if (/mentor|guidance|coach/.test(blobs)) tags.add('mentoring');
  if (/startup|entrepreneur|innovation/.test(blobs)) {
    tags.add('startup');
    tags.add('innovation');
    tags.add('entrepreneurship');
  }
  if (/cse|software|computer|coding|tech/.test(blobs)) {
    tags.add('cse');
    tags.add('software');
  }
  if (/engineering/.test(blobs)) tags.add('engineering');
  if (/curriculum|flexible|interdisciplinary/.test(blobs)) tags.add('curriculum');
  if (tags.size === 0) {
    tags.add('projects');
    tags.add('industry');
    tags.add('hands_on');
  }
  return tags;
}

/**
 * Score curated catalog by profile fit. NIAT may rank in Top-3 when tags fit;
 * never forced to #1.
 */
function selectTop3PreviewInstitutions(profile = {}, limit = STAGE5_PREVIEW_LIMIT) {
  const signals = profileSignalTags(profile);
  const scored = CURATED_MODERN_CATALOG.map((item, idx) => {
    const itemTags = Array.isArray(item.tags) ? item.tags : [];
    let score = itemTags.reduce((acc, t) => acc + (signals.has(t) ? 1 : 0), 0);
    // Slight mid-list stability so curated order breaks ties without forcing NIAT first.
    score += (CURATED_MODERN_CATALOG.length - idx) * 0.01;
    return { item, score, idx };
  }).sort((a, b) => b.score - a.score || a.idx - b.idx);

  return scored.slice(0, limit).map(({ item }) => ({
    name: item.name,
    why: item.why,
    source: 'stage5_preview',
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

function formatStage5Preview(institutions) {
  const lines = [getExploreMessage('preview_intro'), ''];
  (institutions || []).slice(0, STAGE5_PREVIEW_LIMIT).forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} — ${it.why}`);
  });
  lines.push('', getExploreMessage('preview_outro'));
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

/**
 * Stage 5 YES → Top-3 personalized preview + first Stage 6 question in one bubble.
 * Skips pers_transition "Ready?" gate.
 */
async function advanceToPersonalization(inbound, ctx, analyticsMeta = {}, opts = {}) {
  const {
    startPersonalizedDiscoveryFromExplore,
  } = require('./careerCounsellingV2PersonalizationEngine');
  const profile = {
    ...(ctx.profile || {}),
    exploreModernCompleted: true,
  };
  const preview = selectTop3PreviewInstitutions(profile, STAGE5_PREVIEW_LIMIT);
  profile.stage5PreviewInstitutions = preview;

  const started = startPersonalizedDiscoveryFromExplore(
    { ...ctx, profile },
    analyticsMeta,
    { softDeclinePrefix: opts.softDeclinePrefix || '' }
  );
  return started;
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
  STAGE5_PREVIEW_LIMIT,
  startExploreModernColleges,
  processExploreModernCollegesTurn,
  resolveExploreInstitutions,
  selectCuratedInstitutions,
  selectTop3PreviewInstitutions,
  formatExplorePresent,
  formatStage5Preview,
};
