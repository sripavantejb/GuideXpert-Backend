'use strict';

const { normalizeText } = require('../intentTextUtils');
const {
  getPhase11Message,
} = require('../../../constants/careerCounsellingV2FinalDecisionHesitation');
const {
  classifyHesitation,
  isReassuranceAsk,
  countMultiTopics,
  ESCALATION_THRESHOLDS,
} = require('./careerCounsellingV2FinalDecisionHesitationCore');

function isHesitationNone(text) {
  const t = normalizeText(text);
  return /^(no|none|nope|nah|nothing|nil|ready|im ready|i am ready|all good|all clear|no hesitation|nothing left|lets continue|continue|ok|okay|yes ready)$/i.test(
    t
  );
}

function isConfidenceYes(text) {
  const t = normalizeText(text);
  return /^(yes|y|yeah|yep|sure|ok|okay|better|helps|helped|more confident|confident)$/i.test(t);
}

function isConfidenceNo(text) {
  const t = normalizeText(text);
  return /^(no|n|nope|not really|still unsure|still worried|not yet)$/i.test(t);
}

function isHesitationQuestion(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain)\b/i.test(raw);
}

function isEscalationDone(text) {
  const t = normalizeText(text);
  return /^(done|thanks|thank you|ok|okay|got it|finish|finished)$/i.test(t);
}

/** Explicit ask for human / expert counseling (escalation path). */
function looksLikeExpertRequest(text) {
  return /\b(speak (to|with)|talk (to|with)|connect (me )?to|meet)\b.{0,40}\b(expert|counsellor|counselor|human|alumni)\b|\b(expert|counsellor|counselor)\b.{0,40}\b(please|help|guidance|session)\b|\bone[ -]?on[ -]?one\b|\b1[ -]?on[ -]?1\b|\bhuman (guidance|counsellor|counselor)\b/i.test(
    String(text || '')
  );
}

function looksLikeBookingOrCounselor(text) {
  return /\b(book|booking|counsellor|counselor|session|meeting|whatsapp)\b/i.test(
    String(text || '')
  );
}

function looksLikeCompare(text) {
  return /\b(compar\w*|which college|best match|rank(ing)?|shortlist again)\b/i.test(
    String(text || '')
  );
}

function looksLikeVisionReplay(text) {
  return /\b(future path|vision|what (will|could) my future)\b/i.test(String(text || ''));
}

function looksLikePhase7Restart(text) {
  return /\b(start over|re-?evaluate|go back to concerns|objection)\b/i.test(String(text || ''));
}

function parseHesitationOrNone(text) {
  if (isHesitationNone(text)) return { kind: 'none' };
  if (looksLikeExpertRequest(text) || looksLikeBookingOrCounselor(text)) {
    return { kind: 'expert_request', rawAnswer: String(text || '').slice(0, 200) };
  }
  if (looksLikeCompare(text)) {
    return { kind: 'deflect', reply: getPhase11Message('deflect_compare') };
  }
  if (looksLikeVisionReplay(text)) {
    return { kind: 'deflect', reply: getPhase11Message('deflect_vision') };
  }
  if (looksLikePhase7Restart(text)) {
    return { kind: 'deflect', reply: getPhase11Message('deflect_phase7') };
  }
  const classified = classifyHesitation(text);
  if (classified) {
    const topics = countMultiTopics(text);
    const multiTopic = topics.length >= ESCALATION_THRESHOLDS.minMultiTopicsInUtterance;
    return {
      kind: 'hesitation',
      ...classified,
      multiTopic,
      multiTopics: topics,
      reassuranceAsk: isReassuranceAsk(text),
    };
  }
  return null;
}

module.exports = {
  isHesitationNone,
  isConfidenceYes,
  isConfidenceNo,
  isHesitationQuestion,
  isEscalationDone,
  looksLikeExpertRequest,
  parseHesitationOrNone,
  classifyHesitation,
};
