'use strict';

/**
 * GuideXpert V2 — Stage 5 Explore Modern Colleges (Interactive Framework).
 * Shows Top 10 named colleges after condensed Stage 4 permission; then Stage 6 personalization.
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

const EXPLORE_ENGINE_VERSION = 'v2.1.0-named-catalog';
const EXPLORE_PRESENT_LIMIT = 10;

/**
 * Named modern / future-ready colleges — equal representation, NIAT included (not only).
 */
const CURATED_MODERN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'cbit',
    name: 'CBIT',
    why: 'Strong placement ecosystem with structured interview prep',
    tags: ['placements', 'engineering', 'cse', 'job', 'software', 'hyderabad'],
  }),
  Object.freeze({
    id: 'vasavi',
    name: 'Vasavi College of Engineering',
    why: 'Balanced academics with solid campus recruiting outcomes',
    tags: ['placements', 'engineering', 'cse', 'balanced', 'hyderabad'],
  }),
  Object.freeze({
    id: 'vnr',
    name: 'VNR VJIET',
    why: 'Strong coding culture with clubs, contests, and peer learning',
    tags: ['projects', 'coding', 'cse', 'software', 'hands_on', 'hyderabad'],
  }),
  Object.freeze({
    id: 'griet',
    name: 'GRIET',
    why: 'Industry-linked programmes with internship pathways',
    tags: ['industry', 'internships', 'placement', 'software', 'engineering'],
  }),
  Object.freeze({
    id: 'cvr',
    name: 'CVR College of Engineering',
    why: 'Practical labs and career-focused engineering tracks',
    tags: ['engineering', 'cse', 'projects', 'placements', 'hyderabad'],
  }),
  Object.freeze({
    id: 'mgit',
    name: 'MGIT',
    why: 'Accessible fees with steady placement support',
    tags: ['fees', 'afford', 'budget', 'engineering', 'placements'],
  }),
  Object.freeze({
    id: 'sreenidhi',
    name: 'Sreenidhi Institute of Science and Technology',
    why: 'Active campus life with hostels, clubs, and student communities',
    tags: ['environment', 'campus', 'hostel', 'culture', 'engineering'],
  }),
  Object.freeze({
    id: 'iiith',
    name: 'IIIT Hyderabad',
    why: 'Research-led learning with AI-first coursework and applied labs',
    tags: ['research', 'ai', 'projects', 'cse', 'data', 'software'],
  }),
  Object.freeze({
    id: 'niat',
    name: 'NIAT (NxtWave Institute of Advanced Technologies)',
    why: 'Industry-focused curriculum and project-based learning',
    tags: ['engineering', 'cse', 'it', 'software', 'ai', 'hands_on', 'projects', 'industry'],
  }),
  Object.freeze({
    id: 'jntuh',
    name: 'JNTUH',
    why: 'Broad engineering foundation with recognized university pathways',
    tags: ['engineering', 'curriculum', 'balanced', 'hyderabad', 'university'],
  }),
]);

const MESSAGES = Object.freeze({
  intro: '',

  present_header: 'Here are 10 modern colleges worth exploring.',

  ask_continue: 'Would you like me to narrow these down based on your goals?',

  continue_clarify:
    'Reply Yes to personalize further (budget, city, preferences), or ask why any option fits.',

  soft_decline_advance:
    "No problem — we'll still personalize with a few quick preferences so matches stay practical.",

  why_fallback:
    'Selected because it aligns with the modern learning approach we discussed.',

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
