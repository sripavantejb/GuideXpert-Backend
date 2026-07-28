'use strict';

const {
  COUNSELLING_QA,
  GENERIC_COUNSELLING_FALLBACK,
} = require('../../../constants/careerCounsellingJourney');

const BLOCKED_ANSWER_TERMS =
  /\b(niat|scaler|newton|admission test|nat exam|scholarship|register now|sign up)\b/i;

const QUESTION_SIGNAL =
  /\?\s*$|\b(what|how|why|when|where|which|who|can i|should i|is it|are there|tell me|explain|difference between|meaning of)\b/i;

function isCounsellingQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (BLOCKED_ANSWER_TERMS.test(t)) return false;
  return QUESTION_SIGNAL.test(t);
}

function answerCounsellingQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  for (const entry of COUNSELLING_QA) {
    if (entry.patterns.some((re) => re.test(t))) {
      return entry.answer;
    }
  }

  if (isCounsellingQuestion(t)) {
    return GENERIC_COUNSELLING_FALLBACK;
  }

  return null;
}

module.exports = {
  isCounsellingQuestion,
  answerCounsellingQuestion,
};
