'use strict';

const { normalizeText } = require('../intentTextUtils');
const { PHASE9_QA } = require('../../../constants/careerCounsellingV2PersonalizedRecommendation');

function isPhase9Continue(text) {
  const t = normalizeText(text);
  return /^(yes|y|ok|okay|sure|continue|next|proceed|ready|go ahead|lets go|let us go)$/i.test(
    t
  ) || /\b(continue|next step|ready)\b/i.test(t);
}

function isPhase9Question(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain|difference|trade|confidence|sure)\b/i.test(raw);
}

function answerPhase9Question(text) {
  const t = String(text || '').trim();
  for (const entry of PHASE9_QA) {
    if (entry.patterns.some((re) => re.test(t))) return entry.answer;
  }
  return null;
}

module.exports = {
  isPhase9Continue,
  isPhase9Question,
  answerPhase9Question,
};
