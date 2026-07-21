'use strict';

/**
 * GuideXpert V2 — Stage 5 Explore Modern Colleges (Interactive Framework).
 *
 * Curated showcase of new-age / modern learning models that echo Stage 4
 * (industry projects, AI tools, mentorship, internships). This is NOT a
 * popularity ranking of traditional engineering colleges.
 *
 * After Stage 4 permission → present showcase → Stage 6 personalization.
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

const EXPLORE_ENGINE_VERSION = 'v2.2.0-new-age-showcase';
const EXPLORE_PRESENT_LIMIT = 10;

/**
 * New-age / modern-learning showcase — equal representation.
 * Order is pedagogical (diverse models), not popularity or brand rank.
 * NIAT is included once, mid-list — never the sole option, never forced first.
 */
const CURATED_MODERN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'plaksha',
    name: 'Plaksha University',
    why: 'Project studios and interdisciplinary tech learning with real problem briefs',
    model: 'project_based',
    tags: ['projects', 'hands_on', 'engineering', 'cse', 'innovation', 'curriculum'],
  }),
  Object.freeze({
    id: 'iiitd',
    name: 'IIIT Delhi',
    why: 'Applied CS and AI learning tied to research labs and industry problems',
    model: 'ai_first',
    tags: ['ai', 'projects', 'cse', 'software', 'research', 'industry'],
  }),
  Object.freeze({
    id: 'iiitb',
    name: 'IIIT Bangalore',
    why: 'Product-oriented IT education with strong industry and startup exposure',
    model: 'industry_integrated',
    tags: ['industry', 'internships', 'cse', 'software', 'startup', 'placements'],
  }),
  Object.freeze({
    id: 'snu',
    name: 'Shiv Nadar University',
    why: 'Innovation-led campus with research, entrepreneurship, and mentorship pathways',
    model: 'innovation_driven',
    tags: ['innovation', 'entrepreneurship', 'startup', 'research', 'mentoring', 'curriculum'],
  }),
  Object.freeze({
    id: 'niat',
    name: 'NIAT (NxtWave Institute of Advanced Technologies)',
    why: 'Industry-integrated curriculum with project-based and mentor-led learning',
    model: 'industry_integrated',
    tags: ['industry', 'projects', 'hands_on', 'ai', 'cse', 'software', 'internships', 'mentoring'],
  }),
  Object.freeze({
    id: 'ahmedabad_univ',
    name: 'Ahmedabad University',
    why: 'Project-based interdisciplinary programmes that mix theory with application',
    model: 'project_based',
    tags: ['projects', 'curriculum', 'hands_on', 'balanced', 'innovation'],
  }),
  Object.freeze({
    id: 'krea',
    name: 'Krea University',
    why: 'Flexible modern curriculum designed around curiosity, mentors, and real projects',
    model: 'innovation_driven',
    tags: ['curriculum', 'mentoring', 'projects', 'innovation', 'balanced'],
  }),
  Object.freeze({
    id: 'iiith',
    name: 'IIIT Hyderabad',
    why: 'AI-first coursework with applied labs, research exposure, and builder culture',
    model: 'ai_first',
    tags: ['ai', 'projects', 'cse', 'data', 'software', 'research', 'hands_on'],
  }),
  Object.freeze({
    id: 'scaler_sot',
    name: 'Scaler School of Technology',
    why: 'Industry-built engineering path focused on projects, tools, and job-ready skills',
    model: 'industry_integrated',
    tags: ['industry', 'projects', 'cse', 'software', 'placements', 'hands_on', 'internships'],
  }),
  Object.freeze({
    id: 'upes',
    name: 'UPES Dehradun',
    why: 'Specialized industry-aligned tracks with internship and workplace exposure',
    model: 'industry_integrated',
    tags: ['industry', 'internships', 'engineering', 'placements', 'curriculum'],
  }),
]);

const MESSAGES = Object.freeze({
  intro: '',

  present_header:
    'Here are 10 modern, new-age colleges worth exploring — each represents a learning model close to what we just discussed.',

  ask_continue: 'Would you like me to narrow these down based on your goals?',

  continue_clarify:
    'Reply Yes to personalize further (budget, city, preferences), or ask why any option fits.',

  soft_decline_advance:
    "No problem — we'll still personalize with a few quick preferences so matches stay practical.",

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
