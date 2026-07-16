'use strict';

/**
 * Deterministic booking support — pattern matching only.
 * Never routes to LLM / RAG / ICE / CPA / ICS.
 */

const { normalizeText } = require('../intentTextUtils');
const { isExplicitHumanHandoffRequest } = require('../foundationConversation/humanHandoffIntent');

const MENU_BOOKING_SUPPORT = /^2$/;

const DETERMINISTIC_QUERY_PATTERNS = [
  { id: 'session_when', pattern: /\bwhen is my (counselling|counseling|session|appointment|slot|booking)\b/i },
  { id: 'session_when', pattern: /\bwhen is my\b/i },
  { id: 'session_time', pattern: /\bwhat time is my (session|counselling|counseling|appointment|slot|booking)\b/i },
  { id: 'session_time', pattern: /\bwhat time is my\b/i },
  { id: 'session_join', pattern: /\bwhen should i join\b/i },
  { id: 'booking_status', pattern: /\bwhat is my booking status\b/i },
  { id: 'booking_status', pattern: /\bwhat is my booking status\b/i },
  { id: 'booking_status', pattern: /\bdid my booking go through\b/i },
  { id: 'counsellor', pattern: /\bwho is assigned\b/i },
  { id: 'booking_summary', pattern: /\bshow my booking\b/i },
  { id: 'booking_summary', pattern: /\bmy booking (details|summary|status)\b/i },
  { id: 'counsellor', pattern: /\bwho is my (counsellor|counselor|bda|expert)\b/i },
  { id: 'counsellor', pattern: /\bwho is assigned\b/i },
  { id: 'counsellor', pattern: /\bassigned expert\b/i },
  { id: 'counsellor', pattern: /\bmy counsellor\b/i },
  { id: 'counsellor', pattern: /\bmy counselor\b/i },
  { id: 'counsellor', pattern: /\bmy bda\b/i },
  { id: 'meeting_link', pattern: /\bwhat is my meeting link\b/i },
  { id: 'meeting_link', pattern: /\bshare my meeting link\b/i },
  { id: 'meeting_link', pattern: /\bmeeting link\b/i },
  { id: 'exam', pattern: /\bwhat exam did i register for\b/i },
  { id: 'branch', pattern: /\bwhich branch did i choose\b/i },
  { id: 'branch', pattern: /\bwhat branch preference did i choose\b/i },
  { id: 'college', pattern: /\bwhich college did i choose\b/i },
  { id: 'college', pattern: /\bwhat college preference did i give\b/i },
  { id: 'category', pattern: /\bwhat category did i (select|submit)\b/i },
  { id: 'rank', pattern: /\bwhat rank did i (submit|register with)\b/i },
  { id: 'session_summary', pattern: /\bmy (session|slot|counselling|counseling|booking|meeting)\b/i },
  { id: 'prep', pattern: /\bhow do i prepare\b/i },
  { id: 'documents', pattern: /\bwhat documents should i carry\b/i },
  { id: 'documents', pattern: /\bwhat documents (do i|should i) (bring|carry)\b/i },
];

const BOOKING_CREATE_PATTERNS = [
  /\bbook (my )?(counselling|counseling|session|appointment)\b/i,
  /\bschedule (my )?(counselling|counseling|session|appointment)\b/i,
  /\bregister (my )?(counselling|counseling|session)\b/i,
  /\bregister counselling\b/i,
  /\bneed (a )?counselling session\b/i,
  /\bbook a session\b/i,
  /\bneed counselling session\b/i,
  /\bneed (to )?book\b/i,
  /\bbook counselling\b/i,
  /\bbook counseling\b/i,
  /\bschedule counselling\b/i,
  /\bschedule counseling\b/i,
  /\bbook appointment\b/i,
  /\bconfirm booking\b/i,
  /\bbook me\b/i,
  /\byes book\b/i,
];

const RESCHEDULE_CANCEL_PATTERNS = [
  /\breschedule\b/i,
  /\bchange slot\b/i,
  /\bdelete booking\b/i,
  /\bchange slot\b/i,
  /\bdifferent time\b/i,
  /\bmove (my )?(appointment|session|booking)\b/i,
  /\btomorrow instead\b/i,
  /\bnext week instead\b/i,
  /\bcancel (my )?(booking|session|appointment|counselling|counseling)\b/i,
  /\bcancel session\b/i,
  /\bdelete (my )?(appointment|booking|session)\b/i,
  /\bdelete booking\b/i,
  /\bi cannot attend\b/i,
  /\bcan't attend\b/i,
  /\bunable to attend\b/i,
];

function intentTextCandidates(text, originalText = null) {
  const normalized = normalizeText(text);
  const original = originalText ? normalizeText(originalText) : null;
  if (original && original !== normalized) return [normalized, original];
  return [normalized];
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(String(text || '')));
}

function matchDeterministicQuery(text, originalText = null) {
  for (const candidate of intentTextCandidates(text, originalText)) {
    if (!candidate) continue;
    if (MENU_BOOKING_SUPPORT.test(candidate)) {
      return { queryId: 'menu_summary', confidence: 'high' };
    }
    for (const entry of DETERMINISTIC_QUERY_PATTERNS) {
      if (entry.pattern.test(candidate)) {
        return { queryId: entry.id, confidence: 'high' };
      }
    }
  }
  return null;
}

function isBookingSupportQuery(text, originalText = null) {
  return Boolean(matchDeterministicQuery(text, originalText));
}

function isBookingRescheduleOrCancelRequest(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => matchesAny(t, RESCHEDULE_CANCEL_PATTERNS));
}

function isBookingCreateRequest(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => matchesAny(t, BOOKING_CREATE_PATTERNS));
}

function isBookingSupportHandoffRequest(text, originalText = null) {
  if (isExplicitHumanHandoffRequest(text, originalText)) return true;
  return intentTextCandidates(text, originalText).some((t) =>
    /\b(talk to my counsellor|connect me|need support|need help)\b/i.test(t)
  );
}

/**
 * Classify booking support turn for deterministic router.
 * @returns {{ kind: string, queryId?: string, confidence: string }|null}
 */
function resolveBookingSupportIntent(text, originalText = null) {
  if (isBookingRescheduleOrCancelRequest(text, originalText)) {
    return { kind: 'booking_reschedule_cancel', confidence: 'high' };
  }
  if (isBookingCreateRequest(text, originalText)) {
    return { kind: 'booking_create_check', confidence: 'high' };
  }
  if (isBookingSupportHandoffRequest(text, originalText)) {
    return { kind: 'human_handoff', confidence: 'high' };
  }
  const query = matchDeterministicQuery(text, originalText);
  if (query) {
    return { kind: 'booking_deterministic', queryId: query.queryId, confidence: query.confidence };
  }
  return null;
}

module.exports = {
  DETERMINISTIC_QUERY_PATTERNS,
  RESCHEDULE_CANCEL_PATTERNS,
  BOOKING_CREATE_PATTERNS,
  matchDeterministicQuery,
  isBookingSupportQuery,
  isBookingRescheduleOrCancelRequest,
  isBookingCreateRequest,
  isBookingSupportHandoffRequest,
  resolveBookingSupportIntent,
};
