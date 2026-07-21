'use strict';

const { PHASE9_QA } = require('../../../constants/careerCounsellingV2PersonalizedRecommendation');
const {
  isPermissionAffirmative,
} = require('../permissionAffirmative');

function isPhase9Continue(text) {
  return isPermissionAffirmative(text);
}

function isPhase9Question(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\?/.test(raw)) return true;
  if (isPhase9Continue(raw)) return false;
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
