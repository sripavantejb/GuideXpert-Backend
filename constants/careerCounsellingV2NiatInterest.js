'use strict';

/**
 * NIAT interest → One-on-One Counseling transition.
 * Admission-guidance path (not Phase 11 objection escalation).
 */

const ONE_ON_ONE_SESSION_URL = 'https://www.guidexpert.co.in/one-on-one-session';

const NIAT_INTEREST_STAGE = 'niat_interest_one_on_one';
const NIAT_INTEREST_STEP = 'niat_one_on_one_offer';

/** Explicit interest / admission / join / apply — not mere mentions. */
const NIAT_INTEREST_PATTERNS = Object.freeze([
  /\b(i (want|wanna|would like) to (join|apply|enroll|get (into|admission in)))\b.{0,40}\bniat\b/i,
  /\bniat\b.{0,40}\b(i (want|wanna|would like) to (join|apply|enroll))\b/i,
  /\b(i('m| am) interested in)\b.{0,30}\bniat\b/i,
  /\binterested in (joining )?niat\b/i,
  /\bhow (do i|to|can i) (take |get )?(admission|into|join|apply).{0,40}\bniat\b/i,
  /\b(admission|apply|joining|enroll).{0,40}\bniat\b/i,
  /\bniat\b.{0,40}\b(admission process|admissions?|apply|joining|enroll)\b/i,
  /\bcan i get into niat\b/i,
  /\b(get|getting) (into|admission (in|to|at)) niat\b/i,
  /\bniat is the right (choice|fit|option|college|path|decision)\b/i,
  /\bi think niat is (the )?right\b/i,
  /\bjoin niat\b/i,
  /\btell me about joining niat\b/i,
  /\b(want|need) (niat )?admission\b.{0,20}\bniat\b/i,
  /\badmission process (for |at |in )?niat\b/i,
]);

/** Informational / comparison — must not trigger. */
const NIAT_NON_INTEREST_PATTERNS = Object.freeze([
  /\bwhat (exactly )?is niat\b/i,
  /\bniat means\b/i,
  /\bexplain niat\b/i,
  /\btell me about niat\b(?!.{0,20}\b(join|admission|apply|enroll)\b)/i,
  /\b(compar\w*|vs\.?|versus|difference between|which is better)\b/i,
  /\bshortlist\b.{0,40}\bniat\b/i,
  /\bniat\b.{0,40}\b(vs\.?|versus|compared)\b/i,
]);

const GUARANTEE_FORBIDDEN = Object.freeze([
  /\bguaranteed?\b/i,
  /\bassure[ds]?\b/i,
  /\bwill (get|secure|land) (admission|scholarship|placement)\b/i,
  /\b100%\b/,
  /\bmust (book|decide)\b/i,
  /\byou have to (book|join)\b/i,
  /\bmandatory\b/i,
]);

const MESSAGES = Object.freeze({
  soft_close:
    'This session is optional — only if you’d like personalized admission guidance. Reply *Done* when you’re finished here.',
});

function buildNiatOneOnOneReply() {
  return [
    "I'm glad to hear that you're interested in NIAT.",
    '',
    "Since every student's academic background, career goals, and eligibility are different, the best next step is to have a personalized One-on-One Counseling Session with one of our experienced career counselors, including IIT alumni where applicable.",
    '',
    'During the session, they can:',
    '',
    '• Understand your profile in detail.',
    '• Explain NIAT programs and learning pathways.',
    '• Clarify eligibility and admissions.',
    '• Answer your questions.',
    '• Help you make the right academic decision.',
    '',
    'You can book your personalized One-on-One Counseling Session here:',
    '',
    ONE_ON_ONE_SESSION_URL,
    '',
    MESSAGES.soft_close,
  ].join('\n');
}

module.exports = {
  ONE_ON_ONE_SESSION_URL,
  NIAT_INTEREST_STAGE,
  NIAT_INTEREST_STEP,
  NIAT_INTEREST_PATTERNS,
  NIAT_NON_INTEREST_PATTERNS,
  GUARANTEE_FORBIDDEN,
  MESSAGES,
  buildNiatOneOnOneReply,
};
