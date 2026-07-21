'use strict';

/**
 * GuideXpert V2 — Stage 5 Explore Modern Colleges (Interactive Framework).
 *
 * Showcase of India's new-age higher education ecosystem (Stage 4 bridge).
 * NOT traditional engineering colleges, IIITs/IITs/NITs, or popularity rankings.
 *
 * Flow: Stage 4 permission → Stage 5 showcase → Stage 6 personalization.
 */

const FLOW_ID = 'career_counselling_v2';

const STAGES = Object.freeze({
  EXPLORE_MODERN_COLLEGES: 'explore_modern_colleges',
  AI_SHORTLISTING: 'ai_shortlisting',
  PERSONALIZED_DISCOVERY: 'personalized_discovery',
});

const EXPLORE_STEPS = Object.freeze([
  'explore_intro',
  'explore_present',
  'explore_ask_continue',
]);

const EXPLORE_ENGINE_VERSION = 'v2.4.0-unified-paths';
const EXPLORE_PRESENT_LIMIT = 5;
const STAGE5_PREVIEW_LIMIT = 3;

/**
 * Genuine new-age institutions only — fixed curated order (not popularity rank).
 * NIAT is included once, mid-list — never the sole option, never forced first.
 */
const CURATED_MODERN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'plaksha',
    name: 'Plaksha University',
    why: 'Interdisciplinary tech education with project studios and real-world problem briefs',
    model: 'project_based',
    tags: ['projects', 'hands_on', 'engineering', 'cse', 'innovation', 'curriculum'],
  }),
  Object.freeze({
    id: 'scaler_sot',
    name: 'Scaler School of Technology',
    why: 'Software engineering program with extensive mentorship from industry professionals',
    model: 'industry_integrated',
    tags: ['industry', 'mentoring', 'projects', 'cse', 'software', 'placements', 'hands_on'],
  }),
  Object.freeze({
    id: 'newton_sot',
    name: 'Newton School of Technology',
    why: 'Project-based computer science education focused on employability',
    model: 'project_based',
    tags: ['projects', 'cse', 'software', 'placements', 'hands_on', 'internships'],
  }),
  Object.freeze({
    id: 'kalvium',
    name: 'Kalvium (Partner University Programs)',
    why: 'Work-integrated CS pathway with continuous projects and industry-ready skills',
    model: 'industry_integrated',
    tags: ['industry', 'projects', 'cse', 'software', 'internships', 'hands_on'],
  }),
  Object.freeze({
    id: 'niat',
    name: 'NIAT (NxtWave Institute of Advanced Technologies)',
    why: 'AI-first curriculum with industry-integrated learning and real-world projects',
    model: 'ai_first',
    tags: ['ai', 'industry', 'projects', 'hands_on', 'cse', 'software', 'internships', 'mentoring'],
  }),
  Object.freeze({
    id: 'masters_union',
    name: "Masters' Union School of Emerging Technologies",
    why: 'Emerging-tech programs built around mentors, startups, and applied learning',
    model: 'innovation_driven',
    tags: ['innovation', 'startup', 'mentoring', 'industry', 'entrepreneurship', 'projects'],
  }),
  Object.freeze({
    id: 'krea',
    name: 'Krea University',
    why: 'Flexible modern curriculum designed around curiosity, mentors, and real projects',
    model: 'innovation_driven',
    tags: ['curriculum', 'mentoring', 'projects', 'innovation', 'balanced'],
  }),
  Object.freeze({
    id: 'ahmedabad_univ',
    name: 'Ahmedabad University',
    why: 'Project-based interdisciplinary programmes that blend theory with application',
    model: 'project_based',
    tags: ['projects', 'curriculum', 'hands_on', 'balanced', 'innovation'],
  }),
  Object.freeze({
    id: 'upes',
    name: 'UPES',
    why: 'Specialized industry-aligned tracks with strong internship and workplace exposure',
    model: 'industry_integrated',
    tags: ['industry', 'internships', 'engineering', 'placements', 'curriculum'],
  }),
  Object.freeze({
    id: 'srm_ap',
    name: 'SRM AP University',
    why: 'Future-ready programmes with industry partnerships and applied learning pathways',
    model: 'industry_integrated',
    tags: ['industry', 'engineering', 'cse', 'internships', 'curriculum', 'placements'],
  }),
]);

const MESSAGES = Object.freeze({
  intro: '',

  present_header:
    'Here are some leading new-age institutions in India that are reimagining higher education through industry-integrated, project-based, and future-ready learning.',

  ask_continue: 'Would you like me to shortlist the colleges that best match your goals?',

  continue_clarify:
    'Reply Yes to shortlist modern colleges that fit your goals, or ask why any option fits.',

  soft_decline_advance:
    "No problem — we'll still personalize with a few quick preferences so matches stay practical.",

  preview_intro:
    "Based on what you've shared so far, here are three modern institutions that appear to align well with your interests. This isn't your final recommendation yet—I'll personalize it further as I learn more about your preferences.",

  preview_outro:
    "To narrow these down, I'd like to understand a few more things about your preferences.",

  why_fallback:
    'Selected because it reflects the modern learning approach we discussed — projects, industry exposure, or applied skills.',

  no_items: [
    'I could not surface a full set just now.',
    'Would you like to share budget and city so I can narrow options personally?',
  ].join('\n'),
});

function getExploreMessage(key) {
  return MESSAGES[key] || '';
}

function isExplorePermissionYes(text) {
  return /^\s*(y|yes|yeah|yep|ok|okay|sure|ready|continue|go ahead|next|narrow|personalize|shortlist)\s*[.!?]?\s*$/i.test(
    String(text || '').trim()
  );
}

function isExplorePermissionNo(text) {
  return /^\s*(n|no|nope|not now|later|skip)\s*[.!?]?\s*$/i.test(String(text || '').trim());
}

module.exports = {
  FLOW_ID,
  STAGES,
  EXPLORE_STEPS,
  EXPLORE_ENGINE_VERSION,
  EXPLORE_PRESENT_LIMIT,
  STAGE5_PREVIEW_LIMIT,
  CURATED_MODERN_CATALOG,
  MESSAGES,
  getExploreMessage,
  isExplorePermissionYes,
  isExplorePermissionNo,
};
