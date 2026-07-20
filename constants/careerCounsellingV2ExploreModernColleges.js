'use strict';

/**
 * GuideXpert V2 — Phase 5 Explore Modern Colleges.
 * Introduces named modern institutions before AI shortlisting.
 * Earlywave when exam+rank exist; otherwise curated catalog.
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

const EXPLORE_ENGINE_VERSION = 'v1.0.0';

/**
 * Curated modern / future-ready programmes (no rank required).
 * Tags match preferredCourse / learningStyle / careerGoal keywords.
 */
const CURATED_MODERN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'niat',
    name: 'NIAT (NxtWave Institute of Advanced Technologies)',
    why: 'Industry-aligned projects and mentoring for software careers.',
    tags: ['engineering', 'cse', 'it', 'software', 'ai', 'btech', 'hands_on', 'industry', 'computer'],
  }),
  Object.freeze({
    id: 'modern_cse_project',
    name: 'Project-first B.Tech CSE programmes',
    why: 'Strong portfolio + internships beat brand-only picks for tech roles.',
    tags: ['engineering', 'cse', 'computer', 'software', 'ai', 'data', 'hands_on', 'projects'],
  }),
  Object.freeze({
    id: 'modern_ece_embedded',
    name: 'Modern ECE / embedded + IoT tracks',
    why: 'Hardware + software labs prepare you for product and core roles.',
    tags: ['ece', 'electronics', 'embedded', 'iot', 'engineering', 'core'],
  }),
  Object.freeze({
    id: 'modern_design_product',
    name: 'Product / design-oriented programmes',
    why: 'Useful if you care about building, UX, and real shipping experience.',
    tags: ['design', 'product', 'startup', 'balanced', 'mentored'],
  }),
  Object.freeze({
    id: 'modern_mgmt_analytics',
    name: 'Analytics-ready BBA / B.Com pathways',
    why: 'Data + business exposure for careers beyond pure theory.',
    tags: ['commerce', 'bba', 'management', 'business', 'analytics'],
  }),
]);

const MESSAGES = Object.freeze({
  intro: [
    'Before a full shortlist, let’s widen your view.',
    'Here are modern institutions / tracks worth considering for your interests.',
  ].join('\n'),

  present_header: 'Worth considering:',

  ask_continue:
    'Ready to build your personalized shortlist from eligibility?',

  continue_clarify: 'Reply Yes to shortlist, or ask why any option fits.',

  soft_decline_advance:
    'No problem — we’ll move to your eligibility shortlist next.',

  why_fallback: 'Matches your stated interests and learning direction.',

  no_items:
    'I’ll still help you shortlist from eligibility next — shall we continue?',
});

function getExploreMessage(key) {
  return MESSAGES[key] || '';
}

function isExplorePermissionYes(text) {
  return /^\s*(y|yes|yeah|yep|ok|okay|sure|ready|continue|go ahead|next)\s*[.!?]?\s*$/i.test(
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
  CURATED_MODERN_CATALOG,
  MESSAGES,
  getExploreMessage,
  isExplorePermissionYes,
  isExplorePermissionNo,
};
