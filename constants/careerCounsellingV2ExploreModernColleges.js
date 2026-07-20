'use strict';

/**
 * GuideXpert V2 — Stage 4 Explore Modern Colleges (Interactive Framework).
 * Shows Top 10 colleges after Stage 3 framework permission; then Stage 5 personalization.
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

const EXPLORE_ENGINE_VERSION = 'v2.0.0-interactive';
const EXPLORE_PRESENT_LIMIT = 10;

/**
 * Curated modern / future-ready programmes — equal representation, no NIAT-only push.
 */
const CURATED_MODERN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'placement_ecosystem',
    name: 'Strong Placement Ecosystem Campuses',
    why: 'Strong placement ecosystem with structured interview prep',
    tags: ['placements', 'engineering', 'cse', 'job', 'software'],
  }),
  Object.freeze({
    id: 'research_focus',
    name: 'Research-Oriented Universities',
    why: 'Excellent research opportunities and faculty mentorship',
    tags: ['research', 'curriculum', 'higher_studies', 'faculty'],
  }),
  Object.freeze({
    id: 'niat',
    name: 'NIAT (NxtWave Institute of Advanced Technologies)',
    why: 'Industry-focused curriculum and project-based learning',
    tags: ['engineering', 'cse', 'it', 'software', 'ai', 'hands_on', 'projects', 'industry'],
  }),
  Object.freeze({
    id: 'coding_culture',
    name: 'Coding-Culture Engineering Colleges',
    why: 'Strong coding culture with clubs, contests, and peer learning',
    tags: ['projects', 'coding', 'cse', 'software', 'hands_on', 'environment'],
  }),
  Object.freeze({
    id: 'internship_ecosystem',
    name: 'Internship-Heavy Programmes',
    why: 'Excellent internship ecosystem and industry exposure',
    tags: ['industry', 'internships', 'placement', 'software', 'engineering'],
  }),
  Object.freeze({
    id: 'affordable_value',
    name: 'High-Value Affordable Colleges',
    why: 'Balanced quality with more affordable fee structures',
    tags: ['fees', 'afford', 'budget', 'engineering', 'commerce'],
  }),
  Object.freeze({
    id: 'campus_life',
    name: 'Vibrant Campus-Life Institutions',
    why: 'Active campus life with hostels, clubs, and student communities',
    tags: ['environment', 'campus', 'hostel', 'culture'],
  }),
  Object.freeze({
    id: 'startup_innovation',
    name: 'Startup & Innovation Campuses',
    why: 'Entrepreneurship cells, incubators, and innovation support',
    tags: ['entrepreneurship', 'startup', 'innovation', 'product'],
  }),
  Object.freeze({
    id: 'ai_first',
    name: 'AI-First Learning Tracks',
    why: 'AI-first coursework with applied labs and modern tools',
    tags: ['ai', 'projects', 'cse', 'data', 'software'],
  }),
  Object.freeze({
    id: 'balanced_support',
    name: 'Balanced Academic & Career Support Colleges',
    why: 'Balanced academic and career support without extremes',
    tags: ['balanced', 'mentoring', 'placements', 'curriculum', 'location'],
  }),
]);

const MESSAGES = Object.freeze({
  intro: [
    'Great!',
    '',
    "Based on the framework we've built together, here are some colleges that stand out for students with priorities like yours.",
    '',
    "Each college has its own strengths, so I'll briefly explain what makes each unique before narrowing down the best matches.",
  ].join('\n'),

  present_header: 'Top colleges worth exploring for your framework:',

  ask_continue:
    'Would you like me to narrow this down to the colleges that best match your personal goals and preferences?',

  continue_clarify:
    'Reply Yes to personalize further (budget, city, preferences), or ask why any option fits.',

  soft_decline_advance:
    "No problem — we'll still personalize with a few quick preferences so matches stay practical.",

  why_fallback:
    'Selected because it aligns with the framework we built from your priorities.',

  no_items: [
    'I could not surface a full set just now.',
    'Would you like to share budget and city so I can narrow options personally?',
  ].join('\n'),
});

function getExploreMessage(key) {
  return MESSAGES[key] || '';
}

function isExplorePermissionYes(text) {
  return /^\s*(y|yes|yeah|yep|ok|okay|sure|ready|continue|go ahead|next|narrow|personalize)\s*[.!?]?\s*$/i.test(
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
  CURATED_MODERN_CATALOG,
  MESSAGES,
  getExploreMessage,
  isExplorePermissionYes,
  isExplorePermissionNo,
};
