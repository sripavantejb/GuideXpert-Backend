'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 7 Concern & Objection Resolution.
 * Personalized, evidence-based responses to remaining decision concerns.
 */

const STAGES = Object.freeze({
  CONCERN_RESOLUTION: 'concern_resolution',
  PHASE_9_PERSONALIZED_RECOMMENDATION: 'phase_9_personalized_recommendation',
  PHASE_10_FUTURE_PATH_VISION: 'phase_10_future_path_vision',
  PHASE_11_FINAL_DECISION_HESITATION: 'phase_11_final_decision_hesitation',
  PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION: 'phase_12_personalized_counseling_recommendation',
  PHASE_13_BOOKING_ORCHESTRATOR: 'phase_13_booking_orchestrator',
  PHASE_13_BOOKING_PLACEHOLDER: 'phase_13_booking_placeholder',
  PHASE_14_JOURNEY_COMPLETION: 'phase_14_journey_completion',
  JOURNEY_COMPLETED: 'journey_completed',
  COUNSELING_INVITATION: 'counseling_invitation',
  COUNSELING_INVITATION_PLACEHOLDER: 'counseling_invitation_placeholder',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const CONCERN_RESOLUTION_STEPS = Object.freeze([
  'concern_pick',
  'concern_respond',
  'concern_check_resolved',
  'concern_ask_continue',
]);

const CONCERN_ENGINE_VERSION = 'v1.0.0';

/**
 * Concern categories supported by the resolution engine.
 */
const CONCERN_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'fees',
    label: 'Fees / affordability',
    patterns: [/\bfee(s)?\b|\bcost\b|\bexpensive\b|\bbudget\b|\bafford/i],
  }),
  Object.freeze({
    id: 'branch_choice',
    label: 'Branch / course choice',
    patterns: [/\bbranch\b|\bwrong course\b|\bstream\b|\bwrong branch\b/i],
    aliases: ['branch choice'],
  }),
  Object.freeze({
    id: 'placements',
    label: 'Placements / jobs',
    patterns: [/\bplacement(s)?\b|\bjob(s)?\b|\bpackage(s)?\b/i],
  }),
  Object.freeze({
    id: 'confusion',
    label: 'Confusion / overwhelm',
    patterns: [/\bconfus|\boverwhelm|\bdon'?t know|\bnot sure\b/i],
  }),
  Object.freeze({
    id: 'rank_pressure',
    label: 'Rank / cutoff pressure',
    patterns: [/\brank\b|\bcutoff\b|\bscore pressure\b/i],
    aliases: ['rank pressure'],
  }),
  Object.freeze({
    id: 'peer_pressure',
    label: 'Peer pressure',
    patterns: [/\bpeer\b|\bfriend(s)?\b.*\b(going|joining|choosing)/i],
    aliases: ['peer pressure'],
  }),
  Object.freeze({
    id: 'family_pressure',
    label: 'Family / parent pressure',
    patterns: [/\bfamily\b|\bparent/i],
    aliases: ['family pressure'],
  }),
  Object.freeze({
    id: 'location',
    label: 'Location / relocation',
    patterns: [/\blocation\b|\bfar\b|\bhostel\b|\brelocat/i],
  }),
  Object.freeze({
    id: 'other',
    label: 'Other concern',
    patterns: [],
  }),
]);

const MESSAGES = Object.freeze({
  concern_intro: [
    'Nice — shortlist + comparison done.',
    '',
    'Now let’s clear remaining worries, one at a time.',
  ].join('\n'),

  ask_pick: [
    'Which concern first?',
    '',
    'Number, name, or type a new worry.',
  ].join('\n'),

  no_active_concerns: [
    'No open concerns right now.',
    '',
    'Share a worry — or reply *Continue*.',
  ].join('\n'),

  pick_clarify: 'Pick a concern, describe a new one, or say Continue.',

  check_resolved: [
    'Does that help for now?',
    '',
    'Reply *Yes*, *No*, or another angle.',
  ].join('\n'),

  resolved_ack: 'Got it — marked as addressed ✅',

  still_open_ack: 'Makes sense — keeping it open.',

  ask_continue: [
    'Major concerns look clearer.',
    '',
    'Would you like to continue?',
  ].join('\n'),

  continue_clarify: 'Reply Yes to move ahead, or name another concern.',

  counseling_invitation_placeholder: [
    'Optional counsellor invite is next.',
    '',
    'Coming soon — send a message when ready.',
  ].join('\n'),

  greeting_mid: 'Hello again! Let’s continue clearing remaining worries.',

  awaiting_ack_nudge: 'Pick a concern, ask about it, or say Continue.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  readiness_line: (score) => `Decision readiness: ${score}%.`,
});

const CONCERN_QA = Object.freeze([
  {
    patterns: [/\bhow (do|did) you (answer|address|resolve)/i, /\bwhy this (answer|response)/i],
    answer:
      'Each response uses your stored concerns, counseling profile, comparison context, and recommendation reasons. It is decision support — not a guarantee about admissions or placements.',
  },
]);

function getConcernMessage(key, ...args) {
  const val = MESSAGES[key];
  if (typeof val === 'function') return val(...args);
  return val || '';
}

function getCategoryById(id) {
  return CONCERN_CATEGORIES.find((c) => c.id === id) || CONCERN_CATEGORIES.find((c) => c.id === 'other');
}

function normalizeConcernId(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
  for (const cat of CONCERN_CATEGORIES) {
    if (cat.id === t || cat.id.replace(/_/g, ' ') === t) return cat.id;
    if ((cat.aliases || []).some((a) => a === t)) return cat.id;
    if (String(cat.label || '').toLowerCase() === t) return cat.id;
  }
  return null;
}

module.exports = {
  STAGES,
  CONCERN_RESOLUTION_STEPS,
  CONCERN_ENGINE_VERSION,
  CONCERN_CATEGORIES,
  MESSAGES,
  CONCERN_QA,
  getConcernMessage,
  getCategoryById,
  normalizeConcernId,
};
