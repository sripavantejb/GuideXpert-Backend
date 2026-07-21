'use strict';

/**
 * GuideXpert V2 — Phase 11 Final Decision Hesitation Resolution.
 * Deterministic confidence closure after Phase 9 + 10 (not Phase 7).
 */

const STAGES = Object.freeze({
  PHASE_11_FINAL_DECISION_HESITATION: 'phase_11_final_decision_hesitation',
  /** Approved Phase 12 handoff target (non-escalate exit only). */
  PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION:
    'phase_12_personalized_counseling_recommendation',
  /** @deprecated Legacy invitation stage; retained for Section E invitation regression. */
  PHASE_12_STUB_COUNSELING_INVITATION: 'counseling_invitation',
  COUNSELING_INVITATION: 'counseling_invitation',
  COUNSELING_INVITATION_PLACEHOLDER: 'counseling_invitation_placeholder',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const PHASE11_STEPS = Object.freeze([
  'hesitation_ask',
  'hesitation_respond',
  'hesitation_confirm',
  'hesitation_second',
  'hesitation_escalation',
]);

/** Production freeze baseline v1.1.0. Do not change behavior without explicit freeze waiver. */
const PHASE11_ENGINE_VERSION = 'v1.1.0';

/** Official One-on-One Counseling form — only URL allowed on Phase 11 escalation. */
const ONE_ON_ONE_SESSION_URL = 'https://www.guidexpert.co.in/one-on-one-session';

/** Deterministic escalation thresholds (not the default path). */
const ESCALATION_THRESHOLDS = Object.freeze({
  minPersonalizedResponsesBeforeEscalate: 2,
  minDistinctHesitations: 2,
  minMultiTopicsInUtterance: 3,
  minReassuranceAsks: 2,
  minConfidenceNo: 1,
});

/** Supporting-context topic detectors for multi-concern utterances. */
const MULTI_TOPIC_SIGNALS = Object.freeze([
  Object.freeze({ id: 'parents', pattern: /\bparents?|family|parental\b/i }),
  Object.freeze({ id: 'fees', pattern: /\bfee|fees|afford|budget|cost\b/i }),
  Object.freeze({ id: 'placements', pattern: /\bplacement|job|career\b/i }),
  Object.freeze({ id: 'college', pattern: /\bcollege|campus|admission|branch\b/i }),
  Object.freeze({ id: 'relocation', pattern: /\brelocat|hostel|distance|city|move\b/i }),
  Object.freeze({ id: 'uncertainty', pattern: /\bunsure|uncertain|confused|hesitat\b/i }),
]);

/** Phase 11 taxonomy only — do not reuse Phase 7 concern ids. */
const HESITATION_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'decision_uncertainty',
    label: 'Still unsure',
    patterns: [
      /\bstill unsure\b/i,
      /\bdon'?t know (if|whether)\b/i,
      /\bnot sure (about )?(decid|choos)/i,
      /\bhesitat/i,
      /\bconfused about (decid|choos|next)\b/i,
    ],
  }),
  Object.freeze({
    id: 'parent_alignment',
    label: 'Parents / family agreement',
    patterns: [
      /\bparents? (may |might |won'?t |will not )?(not )?agree\b/i,
      /\bfamily (may |might )?(not )?agree\b/i,
      /\bparents? (won'?t|will not) (allow|accept|approve)\b/i,
      /\bconvince (my )?parents?\b/i,
      /\bparental\b/i,
    ],
  }),
  Object.freeze({
    id: 'wrong_choice_fear',
    label: 'Fear of choosing wrong',
    patterns: [
      /\bwrong (decision|choice|path)\b/i,
      /\bregret\b/i,
      /\bwhat if .{0,40}wrong\b/i,
      /\bmistake\b/i,
      /\bchoose wrong\b/i,
    ],
  }),
  Object.freeze({
    id: 'academic_manageability',
    label: 'Academic confidence',
    patterns: [
      /\bcan'?t manage\b/i,
      /\bcannot manage\b/i,
      /\btoo (hard|difficult|tough)\b/i,
      /\bacademic(ally)?\b/i,
      /\bcope with (studies|course|college)\b/i,
      /\bfail\b/i,
    ],
  }),
  Object.freeze({
    id: 'fit_confidence',
    label: 'Is this the right path?',
    patterns: [
      /\bright (choice|path|college|decision)\b/i,
      /\bhow do i know\b/i,
      /\bis this (really )?right\b/i,
      /\bfit (for me|confidence)\b/i,
      /\bsure this is\b/i,
    ],
  }),
]);

const MESSAGES = Object.freeze({
  ask: [
    'Before the next step — any last hesitation about deciding?',
    '',
    'You can share it in a sentence, or reply *No* / *Ready* if you feel clear.',
  ].join('\n'),

  fast_path_ack: 'Understood — we can move to the next step when you’re ready.',

  confirm: 'Does that help you feel more confident about your decision? Reply *Yes* or *No*.',

  second_prompt: 'What’s the one thing still holding you back? (One more answer — then we continue.)',

  continue_clarify: 'Reply *Yes* if that helped, *No* for one more clarification, or share your hesitation in a sentence.',

  greeting_mid: 'Still here. Any last hesitation before we continue?',

  deflect_phase7:
    'We’ve already covered that during counseling. For deciding now: your path is already grounded in what you shared — we won’t reopen evaluation.',

  deflect_compare:
    'We’re not comparing colleges again here — only helping you feel clearer about deciding.',

  deflect_booking:
    'Next steps come after this. For now we’re only clearing any last hesitation about deciding.',

  deflect_vision:
    'The future-path picture is already done. Here we’re only checking final decision confidence.',

  escalation_ack:
    'I understand that choosing the right college is an important decision, and it’s completely natural to have questions before making your final choice.',

  escalation_summary:
    'We’ve explored the options together, but since your concerns are specific to your situation, a personalized discussion with one of our expert counselors may help you make a more confident decision.',

  escalation_value: [
    'During the session, experienced career counselors — including IIT alumni where applicable — can understand your profile in detail, answer your questions, explain different college options, discuss career pathways, and help you choose the path that best fits your goals.',
    'They can also help with parent-related concerns, course selection, and comparing suitable colleges for your situation — without promising admissions, placements, or other outcomes.',
  ].join(' '),

  escalation_cta:
    'If you’d like personalized guidance, you can book your One-on-One Counseling Session here:',

  escalation_soft_close:
    'This is an optional next step — only if you feel it would help. Reply *Done* when you’re finished here.',
});

const GUARANTEE_FORBIDDEN = Object.freeze([
  /\bguaranteed?\b/i,
  /\bassure[ds]?\b/i,
  /\bwill (get|secure|land)\b/i,
  /\b100%\b/,
  /\bmust (decide|choose) now\b/i,
  /\byou have to\b/i,
]);

function getPhase11Message(key) {
  return MESSAGES[key] || '';
}

function getHesitationById(id) {
  return (
    HESITATION_CATEGORIES.find((c) => c.id === id) ||
    HESITATION_CATEGORIES.find((c) => c.id === 'decision_uncertainty')
  );
}

module.exports = {
  STAGES,
  PHASE11_STEPS,
  PHASE11_ENGINE_VERSION,
  ONE_ON_ONE_SESSION_URL,
  ESCALATION_THRESHOLDS,
  MULTI_TOPIC_SIGNALS,
  HESITATION_CATEGORIES,
  MESSAGES,
  GUARANTEE_FORBIDDEN,
  getPhase11Message,
  getHesitationById,
};
