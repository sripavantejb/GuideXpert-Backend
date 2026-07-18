'use strict';

const { normalizeText } = require('../intentTextUtils');
const {
  PHASE10_QA,
  getPhase10Message,
} = require('../../../constants/careerCounsellingV2FuturePathVision');

function isVisionContinue(text) {
  const t = normalizeText(text);
  return (
    /^(yes|y|ok|okay|sure|continue|next|proceed|ready|go ahead|lets go|let us go)$/i.test(t) ||
    /\b(continue|next step|ready)\b/i.test(t)
  );
}

function isVisionQuestion(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain|learn|skill|project|future|path)\b/i.test(raw);
}

function looksLikeObjection(text) {
  return /\b(fee|afford|worried|confused|parent|family|placement|rank pressure|peer)\b/i.test(
    String(text || '')
  );
}

function looksLikeBookingOrCounselor(text) {
  return /\b(book|booking|counsellor|counselor|session|meeting|whatsapp)\b/i.test(
    String(text || '')
  );
}

function looksLikeCompareOrRerank(text) {
  return /\b(compar|which college|best match|rank(ing)?|shortlist again)\b/i.test(
    String(text || '')
  );
}

function answerVisionQuestion(text) {
  const t = String(text || '').trim();
  if (looksLikeBookingOrCounselor(t)) return getPhase10Message('deflect_booking');
  if (looksLikeCompareOrRerank(t)) {
    return 'We’re not re-comparing colleges here — only imagining the learning journey on the path you already have.';
  }
  if (looksLikeObjection(t)) return getPhase10Message('deflect_objection');
  if (/\b(fee|cutoff|hostel|nirf|ranking|placement %|package)\b/i.test(t)) {
    return getPhase10Message('deflect_college_facts');
  }
  for (const entry of PHASE10_QA) {
    if (entry.patterns.some((re) => re.test(t))) return entry.answer;
  }
  return null;
}

module.exports = {
  isVisionContinue,
  isVisionQuestion,
  looksLikeObjection,
  looksLikeBookingOrCounselor,
  looksLikeCompareOrRerank,
  answerVisionQuestion,
};
