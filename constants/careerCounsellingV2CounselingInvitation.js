'use strict';

/**
 * GuideXpert V2 Career Counselling — Phase 8 Personalized Counseling Invitation.
 * Optional human counseling invite; booking only via existing Section E website CTA.
 */

const STAGES = Object.freeze({
  COUNSELING_INVITATION: 'counseling_invitation',
  CONVERSATION_COMPLETE: 'conversation_complete',
});

const INVITATION_STEPS = Object.freeze([
  'invite_offer',
  'invite_questions',
  'conversation_complete',
]);

const INVITATION_ENGINE_VERSION = 'v1.0.0';

/** Soft readiness bands used only to personalize invitation copy (not a hard gate). */
const READINESS_BANDS = Object.freeze({
  READY: 'ready',
  NEARLY_READY: 'nearly_ready',
  EXPLORING: 'exploring',
});

const MESSAGES = Object.freeze({
  choice_prompt: [
    'Want an optional counsellor session on the GuideXpert website?',
    '',
    'Reply *Yes*, *Later*, or ask a question.',
  ].join('\n'),

  accepted: [
    'Great choice 👍',
    '',
    'Book on the website (not WhatsApp):',
    '{url}',
    '',
    'I cannot create a booking inside WhatsApp.',
    '',
    'Type MENU anytime.',
  ].join('\n'),

  deferred: [
    'No pressure.',
    '',
    'When ready, book here:',
    '{url}',
    '',
    'Type MENU anytime.',
  ].join('\n'),

  declined: [
    'Totally fine — it’s optional.',
    '',
    'If you change your mind:',
    '{url}',
    '',
    'Type MENU anytime.',
  ].join('\n'),

  question_fallback: [
    'I can still answer from your profile and shortlist.',
    '',
    'For admissions/scholarships detail, a human session helps:',
    '{url}',
    '',
    'Reply *Yes*, *Later*, or ask another question.',
  ].join('\n'),

  complete_sticky: [
    'This counseling conversation is complete.',
    '',
    'Optional human session:',
    '{url}',
    '',
    'Reply MENU for other options.',
  ].join('\n'),

  greeting_mid: 'Hello again! We can finish the optional invite.',

  awaiting_ack_nudge: 'Reply Yes, Later, or ask a remaining question.',

  clarify_choice: 'Reply *Yes* (website), *Later*, or ask a question.',
});

function withUrl(template, url) {
  return String(template || '').replace(/\{url\}/g, url || '');
}

function getInviteMessage(key, url) {
  return withUrl(MESSAGES[key] || '', url);
}

module.exports = {
  STAGES,
  INVITATION_STEPS,
  INVITATION_ENGINE_VERSION,
  READINESS_BANDS,
  MESSAGES,
  withUrl,
  getInviteMessage,
};
