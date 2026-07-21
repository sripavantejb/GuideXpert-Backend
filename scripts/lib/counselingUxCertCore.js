'use strict';

/**
 * Shared helpers for P0 conversational UX certification.
 * Grades counselor-led experience from the student's perspective.
 */

const {
  nonEmptyLines,
  wordCount,
  MAX_LINES_NORMAL,
  MAX_LINES_EDUCATIONAL,
} = require('../../services/chatbot/careerCounselling/careerCounsellingV2ResponseOptimizer');
const {
  extractAdvanceQuestion,
  mapStageToRoadmapPhase,
  isTerminalContext,
  isEducationalContentReply,
} = require('../../services/chatbot/careerCounselling/careerCounsellingV2PhaseOrchestrator');

const GENERIC_CHATBOT = [
  /What would you like to know next/i,
  /How can I (help|assist) you (today|further)/i,
  /Is there anything else I can help/i,
  /As an AI (language )?model/i,
  /I('m| am) (just )?a language model/i,
];

const ESSAY_MARKERS = [
  /In conclusion,/i,
  /It is important to (note|understand) that/i,
  /There are several factors to consider/i,
  /Let me explain in detail/i,
];

/** Product UX phase labels aligned to code stages. */
const UX_PHASE = Object.freeze({
  discovery: 'Discovery',
  education: 'Education',
  modern_education: 'Modern Colleges (concepts)',
  personalization: 'Personalization',
  explore: 'Explore Modern Colleges',
  shortlisting: 'AI Shortlisting',
  comparison: 'Comparison',
  concern: 'Concern Handling',
  recommendation: 'Recommendation',
  vision: 'Vision',
  hesitation: 'Final Hesitation',
  counseling: 'Counseling Recommendation',
  booking: 'Booking',
  handoff: 'Handoff',
  predictor: 'College Predictor',
  unknown: 'Unknown',
});

const FULL_COUNSELING_PATH = [
  'Discovery',
  'Education',
  'Explore Modern Colleges',
  'Personalization',
  'AI Shortlisting',
  'Comparison',
  'Concern Handling',
  'Recommendation',
  'Vision',
  'Final Hesitation',
  'Counseling Recommendation',
  'Booking',
  'Handoff',
];

const PREDICTOR_BRIDGE_PATH = [
  'College Predictor',
  'Comparison',
  'Concern Handling',
  'Counseling Recommendation',
  'Booking',
];

function stageToUxPhase(stage, step = '') {
  const s = String(stage || '');
  const st = String(step || '');
  if (s.includes('phase_14') || s === 'journey_completed' || st === 'journey_completed') {
    return UX_PHASE.handoff;
  }
  if (s.includes('phase_13') || st.startsWith('booking_')) return UX_PHASE.booking;
  if (s.includes('phase_12') || s.includes('counseling_recommendation')) return UX_PHASE.counseling;
  if (s.includes('phase_11') || s.includes('hesitation') || s.includes('niat')) {
    return UX_PHASE.hesitation;
  }
  if (s.includes('phase_10') || s.includes('future_path') || st.startsWith('vision_')) {
    return UX_PHASE.vision;
  }
  if (s.includes('phase_9') || s.includes('personalized_recommendation')) {
    return UX_PHASE.recommendation;
  }
  if (s.includes('concern')) return UX_PHASE.concern;
  if (s.includes('comparison') || st.startsWith('compare_')) return UX_PHASE.comparison;
  if (s.includes('shortlist') || s === 'ai_shortlisting') return UX_PHASE.shortlisting;
  if (s.includes('explore_modern') || st.startsWith('explore_')) return UX_PHASE.explore;
  if (s.includes('personalized_discovery') || st.startsWith('pers_')) return UX_PHASE.personalization;
  if (s === 'modern_colleges' || st.startsWith('modern_')) return UX_PHASE.modern_education;
  if (s.includes('evaluation') || st.startsWith('eval_')) return UX_PHASE.education;
  if (s === 'discovery' || st.startsWith('awaiting_')) return UX_PHASE.discovery;
  if (s.includes('predictor') || st === 'results' || st === 'exam' || st === 'rank') {
    return UX_PHASE.predictor;
  }
  return UX_PHASE.unknown;
}

function isPredictionExtended(result = {}) {
  const stage = String(result.context?.stage || '');
  const step = String(result.context?.step || '');
  return Boolean(
    result.allowExtendedPrediction ||
      result.skipLineCap ||
      result.keepIntact ||
      result.predictionRunning ||
      /guidexpert\.co\.in/i.test(String(result.reply || '')) ||
      step === 'shortlist_ask_compare' ||
      stage.includes('phase_9') ||
      step === 'results' ||
      // Intact comparison / concern / explore blocks (must not be line-capped)
      stage.includes('smart_comparison') ||
      stage.includes('comparison') ||
      step.startsWith('compare_') ||
      stage.includes('concern') ||
      step.startsWith('concern_') ||
      stage.includes('explore_modern') ||
      step.startsWith('explore_')
  );
}

function gradeTurn({ user, result, previousReply, turnsInSamePhase, consecutiveRepeats = 0 }) {
  const failures = [];
  const warnings = [];
  const reply = String(result?.reply || '');
  const lines = nonEmptyLines(reply);
  const lineCount = lines.length;
  const words = wordCount(reply);
  const ctx = result?.context || {};
  const terminal = isTerminalContext(ctx, result || {});
  const extended = isPredictionExtended(result);
  const educational = !extended && isEducationalContentReply(result || {});
  const uxPhase = stageToUxPhase(ctx.stage, ctx.step);
  const roadmapPhase = mapStageToRoadmapPhase(ctx.stage, ctx.step);
  const advanceQ = extractAdvanceQuestion(reply);

  if (!reply.trim()) {
    failures.push('empty_reply');
  }

  const maxLines = educational ? MAX_LINES_EDUCATIONAL : MAX_LINES_NORMAL;
  if (!extended && lineCount > maxLines) {
    failures.push(`line_cap:${lineCount}>${maxLines}`);
  }

  const maxWords = educational ? 220 : 110;
  if (!extended && words > maxWords) {
    failures.push(`essay_word_count:${words}`);
  }

  for (const re of GENERIC_CHATBOT) {
    if (re.test(reply)) failures.push(`generic_chatbot:${re.source}`);
  }
  for (const re of ESSAY_MARKERS) {
    if (re.test(reply)) failures.push(`essay_marker:${re.source}`);
  }

  if (!terminal && !advanceQ && !result?.allowSkipAdvance) {
    const looksLikeSlotPrompt =
      /\b(Try:|e\.g\.|Example:|Which |What('s| is) your|Reply )/i.test(reply) ||
      /guidexpert\.co\.in/i.test(reply);
    if (!looksLikeSlotPrompt) {
      failures.push('missing_advance_question');
    }
  }

  if (!terminal && !result?.orchestration) {
    if (uxPhase !== UX_PHASE.predictor) {
      failures.push('missing_orchestration_metadata');
    }
  }

  if (consecutiveRepeats >= 3 && !terminal) {
    failures.push('exact_repeat');
  } else if (previousReply && previousReply === reply && !terminal) {
    warnings.push('repeat_once');
  }

  if (turnsInSamePhase >= 14) {
    failures.push(`stuck_phase:${uxPhase}:${turnsInSamePhase}`);
  } else if (turnsInSamePhase >= 10) {
    warnings.push(`long_dwell:${uxPhase}:${turnsInSamePhase}`);
  }

  if (/\?/.test(String(user || '')) && /^(ok|okay|sure|got it|thanks)[.!]?$/i.test(lines[0] || '')) {
    if (lines.length <= 1) failures.push('ignored_user_question');
  }

  const hasValue =
    lines.length >= 2 ||
    /goal|course|budget|fit|rank|college|profile|learning|compare|shortlist|placement|option/i.test(
      reply
    );
  if (!terminal && !hasValue && !extended) {
    warnings.push('thin_value');
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    lineCount,
    words,
    uxPhase,
    roadmapPhase,
    advanceQ,
    extended,
    terminal,
  };
}

function uniqueOrdered(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function detectSkippedPhases(observedPath, expectedPath, intentionalSkips = []) {
  const observed = new Set(observedPath);
  const intentional = new Set(intentionalSkips.map((s) => s.phase));
  const skipped = [];
  for (const phase of expectedPath) {
    if (observed.has(phase)) continue;
    const reason = intentional.has(phase)
      ? intentionalSkips.find((s) => s.phase === phase)
      : null;
    skipped.push({
      phase,
      intentional: Boolean(reason),
      why: reason?.why || 'never_reached',
    });
  }
  return skipped;
}

/** Mock Earlywave colleges for deterministic shortlisting / predictor. */
function mockEligibleColleges() {
  return [
    {
      college_name: 'Hyderabad Tech University',
      college_address: 'Hyderabad',
      district_enum: 'HYDERABAD',
      type: 'private',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 180000,
          cutoff: 25000,
          reservation_categories: [{ cutoff_rank: 25000, category_name: 'OC BOYS' }],
        },
        {
          branch_name: 'Artificial Intelligence and Machine Learning',
          branch_code: 'AIML',
          fee: 200000,
          cutoff: 22000,
          reservation_categories: [{ cutoff_rank: 22000, category_name: 'OC BOYS' }],
        },
      ],
    },
    {
      college_name: 'Andhra Engineering College',
      college_address: 'Visakhapatnam',
      district_enum: 'VISAKHAPATNAM',
      type: 'private',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 220000,
          cutoff: 32000,
          reservation_categories: [{ cutoff_rank: 32000, category_name: 'OC BOYS' }],
        },
      ],
    },
    {
      college_name: 'Coastal Institute of Technology',
      college_address: 'Kakinada',
      district_enum: 'EAST GODAVARI',
      type: 'government',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 150000,
          cutoff: 40000,
          reservation_categories: [{ cutoff_rank: 40000, category_name: 'OC BOYS' }],
        },
      ],
    },
    {
      college_name: 'Rayalaseema University College',
      college_address: 'Tirupati',
      district_enum: 'CHITTOOR',
      type: 'private',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 160000,
          cutoff: 45000,
          reservation_categories: [{ cutoff_rank: 45000, category_name: 'OC GIRLS' }],
        },
      ],
    },
    {
      college_name: 'Deccan Institute of Engineering',
      college_address: 'Hyderabad',
      district_enum: 'RANGAREDDY',
      type: 'private',
      branches: [
        {
          branch_name: 'Artificial Intelligence and Data Science',
          branch_code: 'AIDS',
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000, category_name: 'OC BOYS' }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      type: 'private',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000, category_name: 'OC BOYS' }],
        },
      ],
    },
  ];
}

/**
 * Step-aware student reply generator (simulates realistic WhatsApp students).
 */
function studentReplyForTurn(persona, ctx, botReply, turnIndex) {
  const step = String(ctx?.step || '');
  const stage = String(ctx?.stage || '');
  const reply = String(botReply || '');
  const p = persona || {};

  if (p.interruptAt === turnIndex && p.interruptMsg) return p.interruptMsg;
  if (p.randomAt === turnIndex && p.randomMsg) return p.randomMsg;
  if (p.topicChangeAt === turnIndex && p.topicChangeMsg) return p.topicChangeMsg;
  if (p.languageSwitchAt === turnIndex && p.languageMsg) return p.languageMsg;
  if (p.declineAtSteps && p.declineAtSteps.includes(step)) return p.declineMsg || 'no';

  // Interactive Stage 3 — step must win over bot-reply heuristics (e.g. "Career goal" in summary).
  if (step === 'eval_ask_priorities') {
    return p.evalPriorities || 'placements';
  }
  if (step === 'eval_ask_permission') {
    return p.declineGates ? 'no' : 'yes';
  }
  if (step === 'eval_offer_personalization' || step === 'eval_permission_declined') {
    return p.declineGates ? 'no' : 'yes';
  }

  // Predictor slots
  if (step === 'exam' || /which exam|entrance exam/i.test(reply)) {
    return p.exam || 'TS EAMCET';
  }
  if (step === 'rank' || /\brank\b|\bpercentile\b/i.test(reply)) return String(p.rank || 12000);
  if (step === 'category' || /category/i.test(reply)) return p.category || 'OC Boys';
  if (step === 'gender' || /gender/i.test(reply)) return p.gender || 'Male';
  if (step === 'region' || /AU or SVU|region/i.test(reply)) return p.region || 'AU';
  if (step === 'results') {
    if (p.afterPrediction === 'bridge') return 'yes, compare what matters most';
    if (p.afterPrediction === 'filter') return 'CSE';
    return 'compare';
  }

  // Discovery
  if (step === 'awaiting_qualification' || /current qualification/i.test(reply)) {
    return p.qualification || 'Class 12';
  }
  if (step === 'awaiting_course' || /course or field/i.test(reply)) {
    return p.course || 'B.Tech';
  }
  if (step === 'awaiting_goal' || /career goal|aiming for/i.test(reply)) {
    return p.goal || 'Software engineer';
  }
  if (step === 'awaiting_colleges' || /preferred colleges|college in mind/i.test(reply)) {
    return p.colleges || 'not yet';
  }
  if (step === 'awaiting_language' || /preferred language/i.test(reply)) {
    return p.language || 'English';
  }

  // Shortlist eligibility
  if (step === 'shortlist_ask_exam') return p.exam || 'TS EAMCET';
  if (step === 'shortlist_ask_rank') return String(p.rank || 15000);
  if (step === 'shortlist_ask_category') {
    if (/AU or SVU/i.test(reply)) return p.region || 'AU';
    return p.category || 'OC Boys';
  }
  if (step === 'shortlist_ask_compare') return p.compareYes === false ? 'no' : 'yes';

  // Comparison
  if (step === 'compare_select' || /select|which (two|options)|1 and 2/i.test(reply)) {
    return p.comparePick || '1 and 2';
  }
  if (step.startsWith('compare_') || stage.includes('comparison')) {
    if (/continue|what matters|Ready/i.test(reply)) return 'continue';
    return 'continue';
  }

  // Concern
  if (step.startsWith('concern_') || stage.includes('concern')) {
    if (/continue|ready|next/i.test(reply)) return 'yes';
    if (/worry|concern|hesitat/i.test(reply)) return p.concern || 'fees and placements';
    return 'continue';
  }

  // Personalization
  if (step === 'pers_career_priority') return p.priority || 'placements and skill building';
  if (step === 'pers_location') return p.location || 'Hyderabad, open to relocate';
  if (step === 'pers_budget') return p.budget || 'around 2-3 lakhs';
  if (step === 'pers_family') return p.family || 'parents supportive, prefer good brand';
  if (step === 'pers_concern') return p.concern || 'worried about fees and wrong branch';
  if (step === 'pers_clarify') return p.priority || 'placements';

  // Condensed Stage 4 modern bridge
  if (step === 'modern_condensed') {
    return p.declineGates ? 'no' : 'yes';
  }

  // Modern learning style
  if (step === 'modern_ask_learning_style') {
    return p.learningStyle || 'hands-on projects with internships';
  }

  // Phase 11
  if (step === 'hesitation_ask' || step === 'hesitation_confirm') {
    return p.hesitation || 'ready';
  }

  // Phase 12 / 13
  if (step.startsWith('counsel_rec_') || stage.includes('phase_12')) {
    return 'continue';
  }
  if (step.startsWith('booking_') || stage.includes('phase_13')) {
    if (p.book === false) return 'Later';
    if (/Book now|book/i.test(reply)) return 'Book now';
    return 'Book now';
  }

  // Permission / continue gates
  if (/Would you like to continue|Ready to|Want to|Shall we|Reply Yes or No|Would you like me to shortlist|narrow this down|narrow these down based on your goals/i.test(reply)) {
    if (p.declineGates) return 'no';
    return 'yes';
  }

  // Priorities discovery
  if (/top things you.?re looking for|what matters most to you/i.test(reply)) {
    return 'placements and coding culture';
  }

  // Default continue for teaching slides
  if (/Sound familiar|Ready for|makes sense|Continue|Go on|resonates|shortcut|Shall we|Does this/i.test(reply)) {
    return 'ok';
  }
  if (/\?/.test(reply)) return 'yes';

  return 'ok';
}

module.exports = {
  UX_PHASE,
  FULL_COUNSELING_PATH,
  PREDICTOR_BRIDGE_PATH,
  MAX_LINES_NORMAL,
  MAX_LINES_EDUCATIONAL,
  stageToUxPhase,
  gradeTurn,
  uniqueOrdered,
  detectSkippedPhases,
  mockEligibleColleges,
  studentReplyForTurn,
  nonEmptyLines,
  wordCount,
};
