'use strict';

/**
 * Career Counselling V2 — roadmap phase orchestration metadata.
 * Additive only: does not rename stage/step strings used by Conversation Recovery.
 */

const ROADMAP_PHASE = Object.freeze({
  DISCOVERY: 1,
  GOAL_AND_EVALUATION: 2, // evaluation masterclass (education before recs)
  EDUCATION_FRAMEWORK: 3, // kept for map clarity — evaluation is roadmap P3
  MODERN_EDUCATION: 4,
  EXPLORE_MODERN_COLLEGES: 5,
  PERSONALIZED_DISCOVERY: 6,
  AI_SHORTLISTING: 7,
  SMART_COMPARISON: 8,
  PERSONALIZED_RECOMMENDATION: 9,
  FUTURE_PATH_VISION: 10,
  FINAL_HESITATION: 11,
  COUNSELING_SELECTION: 12,
  BOOKING: 13,
  JOURNEY_COMPLETION: 14,
});

/** User roadmap numbering aligned to product audit (not legacy code comments). */
function mapStageToRoadmapPhase(stage, step = '') {
  const s = String(stage || '');
  const st = String(step || '');

  if (s.includes('phase_14') || s === 'journey_completed' || st === 'journey_completed') {
    return ROADMAP_PHASE.JOURNEY_COMPLETION;
  }
  if (s.includes('phase_13') || s.includes('booking') || st.startsWith('booking_')) {
    return ROADMAP_PHASE.BOOKING;
  }
  if (s.includes('phase_12') || s.includes('counseling_recommendation') || st.startsWith('counsel_rec_')) {
    return ROADMAP_PHASE.COUNSELING_SELECTION;
  }
  if (s.includes('phase_11') || s.includes('hesitation') || s.includes('niat')) {
    return ROADMAP_PHASE.FINAL_HESITATION;
  }
  if (s.includes('phase_10') || s.includes('future_path') || st.startsWith('vision_')) {
    return ROADMAP_PHASE.FUTURE_PATH_VISION;
  }
  if (s.includes('phase_9') || (s.includes('personalized_recommendation') && !s.includes('counseling'))) {
    return ROADMAP_PHASE.PERSONALIZED_RECOMMENDATION;
  }
  if (s.includes('concern')) return ROADMAP_PHASE.SMART_COMPARISON + 0; // concern is between 8 and 9
  // Concern resolution sits after comparison in code; map to 8.5 conceptually as phase 8 continue → treat as 8 until P9
  if (s === 'concern_resolution' || s.includes('concern_resolution')) return 8;
  if (s.includes('comparison') || st.startsWith('compare_')) return ROADMAP_PHASE.SMART_COMPARISON;
  if (s.includes('shortlist') || st.startsWith('shortlist_') || s === 'ai_shortlisting') {
    return ROADMAP_PHASE.AI_SHORTLISTING;
  }
  if (s.includes('explore_modern') || st.startsWith('explore_')) {
    return ROADMAP_PHASE.EXPLORE_MODERN_COLLEGES;
  }
  if (s.includes('personalized_discovery') || st.startsWith('pers_')) {
    return ROADMAP_PHASE.PERSONALIZED_DISCOVERY;
  }
  if (s === 'modern_colleges' || st.startsWith('modern_')) {
    return ROADMAP_PHASE.MODERN_EDUCATION;
  }
  if (s.includes('evaluation') || st.startsWith('eval_')) {
    return ROADMAP_PHASE.EDUCATION_FRAMEWORK;
  }
  if (s === 'discovery' || st.startsWith('awaiting_') || !s) {
    return ROADMAP_PHASE.DISCOVERY;
  }
  if (s.includes('counseling_invitation') || s === 'conversation_complete') {
    return ROADMAP_PHASE.JOURNEY_COMPLETION;
  }
  return ROADMAP_PHASE.DISCOVERY;
}

const NEXT_PHASE = Object.freeze({
  1: 3, // discovery → evaluation framework (interactive)
  3: 4, // framework permission → condensed modern bridge
  4: 5, // condensed modern → explore modern colleges (top 10)
  5: 6, // explore → personalized discovery
  6: 7, // personalization → AI shortlisting
  7: 8,
  8: 9,
  9: 10,
  10: 11,
  11: 12,
  12: 13,
  13: 14,
  14: null,
});

const ADVANCE_QUESTIONS = Object.freeze({
  1: 'What is your current qualification?',
  3: 'What are the top things you’re looking for in a college?',
  4: 'Want me to show colleges that match your framework?',
  5: 'Would you like me to narrow this to colleges that best match your personal goals?',
  6: 'Ready for a few quick questions on location, budget, and family?',
  7: 'Ready to build your personalized shortlist from eligibility?',
  8: 'Want to compare the best options for what matters most to you?',
  9: 'Shall I give you a clear personalized recommendation next?',
  10: 'Want a quick picture of where this path can take you?',
  11: 'Any last hesitation before we talk next steps?',
  12: 'Which counseling experience would help you most?',
  13: 'Ready to book your session on the GuideXpert website?',
  14: null,
});

const REQUIRED_BY_PHASE = Object.freeze({
  1: ['currentQualification', 'preferredCourse', 'careerGoal', 'preferredLanguage'],
  3: ['evaluationPriorities'],
  4: [],
  6: ['careerPriority', 'locationPreference', 'budgetPreference', 'familyPreference'],
  5: [],
  7: ['exam', 'rank'],
  8: ['shortlist'],
  9: ['shortlist'],
  10: [],
  11: [],
  12: ['phase12Service'],
  13: [],
  14: [],
});

function profileMissing(profile = {}, keys = []) {
  const missing = [];
  for (const key of keys) {
    const v = profile[key];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) missing.push(key);
  }
  // shortlist special
  if (keys.includes('shortlist')) {
    const list = profile.shortlist || profile.phase9Recommendations || profile.recommendedColleges;
    if (!list || (Array.isArray(list) && list.length === 0)) {
      if (!missing.includes('shortlist')) missing.push('shortlist');
    }
  }
  if (keys.includes('exam') && !profile.exam && !profile.entranceExam) {
    if (!missing.includes('exam')) missing.push('exam');
  }
  if (keys.includes('rank') && profile.rank == null && profile.percentile == null) {
    if (!missing.includes('rank')) missing.push('rank');
  }
  return missing;
}

function isTerminalContext(ctx = {}, result = {}) {
  const stage = String(ctx.stage || result.context?.stage || '');
  const step = String(ctx.step || result.context?.step || '');
  const profile = ctx.profile || result.context?.profile || {};
  if (result.clearState === true) return true;
  if (profile.journeyCompleted === true) return true;
  if (stage === 'journey_completed' || step === 'journey_completed') return true;
  if (result.allowSkipAdvance === true) return true;
  if (result.predictionRunning === true) return true;
  if (profile.phase13UrlShared === true && (step === 'booking_presented' || step === 'booking_confirmed')) {
    return true;
  }
  return false;
}

/**
 * Extended replies (no hard line cap) are reserved for prediction / shortlist /
 * Phase 9 recommendation / booking URL blocks.
 */
function isExtendedPredictionReply(result = {}) {
  if (result.allowExtendedPrediction === true) return true;
  if (result.predictionRunning === true) return true;
  if (result.skipLineCap === true) return true;

  const reply = String(result.reply || '');
  const stage = String(result.context?.stage || '');
  const step = String(result.context?.step || '');

  // Website booking URL presentation (Phase 13)
  if (/guidexpert\.co\.in/i.test(reply)) return true;

  // AI shortlist result block (not the eligibility slot asks)
  if (
    step === 'shortlist_ask_compare' ||
    step === 'shortlist_present' ||
    (/Best Match/i.test(reply) && stage.includes('shortlist'))
  ) {
    return true;
  }

  // Phase 9 personalized recommendation presentation
  if (
    stage.includes('phase_9') ||
    step.startsWith('phase9_') ||
    /personalized recommendation/i.test(reply)
  ) {
    return true;
  }

  // Smart comparison select + full comparison block
  if (
    stage.includes('smart_comparison') ||
    stage.includes('comparison') ||
    step.startsWith('compare_')
  ) {
    return true;
  }

  // Explore Top-N presentation
  if (stage.includes('explore_modern') || step.startsWith('explore_')) {
    return true;
  }

  // Concern answer with decision-support footer
  if (stage.includes('concern') || step.startsWith('concern_')) {
    return true;
  }

  return false;
}

/** Teaching / interactive framework turns for roadmap Phases 3–5. */
const EDUCATIONAL_TEACHING_STEPS = new Set([
  'eval_ask_priorities',
  'eval_ask_permission',
  'eval_offer_personalization',
  'explore_intro',
  'explore_present',
  'explore_ask_continue',
  // legacy (redirected)
  'eval_transition',
  'eval_common_mistakes',
  'eval_framework',
  'eval_comparison',
  'eval_knowledge_confirm',
  'modern_transition',
  'modern_what_is',
  'modern_traditional_vs',
  'modern_industry_learning',
  'modern_student_story',
  'modern_ask_learning_style',
  'modern_knowledge_summary',
]);

function isEducationalContentReply(result = {}) {
  if (result.educationalContent === true) return true;
  const step = String(result.context?.step || '');
  return EDUCATIONAL_TEACHING_STEPS.has(step);
}

function buildPersonalizedValue(ctx = {}) {
  const p = ctx.profile || {};
  if (p.careerGoal) return `Keeping your goal (${String(p.careerGoal).slice(0, 48)}) in focus.`;
  if (p.preferredCourse) return `This stays aligned with ${String(p.preferredCourse).slice(0, 40)}.`;
  if (p.learningStyle) return `Your learning style preference is noted.`;
  if (p.budgetPreference) return `We’ll keep budget practical.`;
  return 'I’ll keep this tailored to your profile.';
}

function extractAdvanceQuestion(reply) {
  const lines = String(reply || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/\?/.test(lines[i])) return lines[i];
  }
  return null;
}

function ensureAdvanceQuestion(reply, nextPhase, terminal) {
  if (terminal) return String(reply || '').trim();
  const text = String(reply || '').trim();
  if (extractAdvanceQuestion(text)) return text;
  const q = ADVANCE_QUESTIONS[nextPhase] || ADVANCE_QUESTIONS[7];
  if (!q) return text;
  return text ? `${text}\n\n${q}` : q;
}

/**
 * Build orchestration snapshot for a turn.
 */
function buildPhaseSnapshot(ctx = {}, result = {}) {
  const mergedCtx = result.context || ctx || {};
  const currentPhase = mapStageToRoadmapPhase(mergedCtx.stage, mergedCtx.step);
  let nextPhase = NEXT_PHASE[currentPhase];
  if (currentPhase === 8 && String(mergedCtx.stage || '').includes('concern')) {
    nextPhase = 9;
  }
  // Interactive framework: Evaluation (3) → Condensed modern (4) → Explore (5) → Personalization (6)
  if (currentPhase === 3) nextPhase = 4;
  if (currentPhase === 4) nextPhase = 5;
  if (currentPhase === 5) nextPhase = 6;
  if (currentPhase === 6) nextPhase = 7;

  const required = REQUIRED_BY_PHASE[currentPhase] || [];
  const missing = profileMissing(mergedCtx.profile || {}, required);

  let completionStatus = 'in_progress';
  if (mergedCtx.profile?.journeyCompleted) completionStatus = 'journey_complete';
  else if (result.skippedPhaseReason) completionStatus = 'phase_complete';
  else if (missing.length === 0 && nextPhase && result.phaseGateComplete) completionStatus = 'phase_complete';
  else if (result.parked) completionStatus = 'parked';

  return {
    currentPhase,
    nextPhase,
    completionStatus,
    requiredInformation: required,
    missingInformation: missing,
    skippedPhaseReason: result.skippedPhaseReason || mergedCtx.profile?.skippedPhaseReason || null,
  };
}

/**
 * Compose counselor-led reply: answer + value + advance (when needed).
 * Engines already return full reply; we tighten structure without inventing new facts.
 */
function composeCounselorReply(result = {}, inbound = '') {
  const ctx = result.context || {};
  const snapshot = buildPhaseSnapshot(ctx, result);
  const terminal = isTerminalContext(ctx, result);
  const extended = isExtendedPredictionReply(result);
  const educational = !extended && isEducationalContentReply(result);

  let reply = String(result.reply || '').trim();

  // Strip generic dead-end prompts
  reply = reply
    .replace(/\bWhat would you like to know next\??/gi, '')
    .replace(/\bAnything else\??/gi, '')
    .replace(/\bWhat else\??/gi, '')
    .replace(/\bHow can I help\??/gi, '')
    .trim();

  if (!terminal) {
    if (!extended && !educational) {
      const hasQuestion = Boolean(extractAdvanceQuestion(reply));
      const lines = reply.split(/\n+/).map((l) => l.trim()).filter(Boolean);

      // Ensure personalized value appears once (short) — skip on educational teaching
      const value = buildPersonalizedValue(ctx);
      const hasValueHint =
        /goal|course|budget|profile|learning|fit|align/i.test(reply) && lines.length >= 2;

      if (!hasValueHint && lines.length > 0 && lines.length < 5) {
        if (hasQuestion) {
          const q = lines[lines.length - 1];
          const body = lines.slice(0, -1);
          reply = [...body, value, q].filter(Boolean).join('\n');
        } else {
          reply = `${reply}\n${value}`.trim();
        }
      }
    }

    reply = ensureAdvanceQuestion(reply, snapshot.nextPhase, terminal);
  }

  // Persist orchestration on profile lightly
  const nextCtx = {
    ...ctx,
    profile: {
      ...(ctx.profile || {}),
      orchestration: snapshot,
      ...(result.skippedPhaseReason
        ? { skippedPhaseReason: result.skippedPhaseReason }
        : {}),
    },
  };

  return {
    ...result,
    reply,
    context: nextCtx,
    orchestration: snapshot,
    allowExtendedPrediction: extended,
    skipLineCap: extended || result.skipLineCap === true,
    educationalContent: educational || result.educationalContent === true,
    keepIntact: result.keepIntact === true,
  };
}

module.exports = {
  ROADMAP_PHASE,
  mapStageToRoadmapPhase,
  buildPhaseSnapshot,
  composeCounselorReply,
  buildPersonalizedValue,
  ensureAdvanceQuestion,
  extractAdvanceQuestion,
  isTerminalContext,
  isExtendedPredictionReply,
  isEducationalContentReply,
  EDUCATIONAL_TEACHING_STEPS,
  ADVANCE_QUESTIONS,
  NEXT_PHASE,
};
