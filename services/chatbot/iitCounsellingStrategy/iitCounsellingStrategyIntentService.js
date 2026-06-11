'use strict';

const { isExcludedFromIitExpert } = require('../iitCounsellingExpert/iitCounsellingIntentService');
const { isIitCounsellingStrategyEnabled } = require('./iitCounsellingStrategyFlags');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const FACTUAL_ICE_DELEGATION_PATTERNS = [
  /\bwhat is float\b/i,
  /\bwhat is slide\b/i,
  /\bwhat is freeze\b/i,
  /\bwhat is (crl|obc|csab|jos+a+a?)\b/i,
  /\bwhat is the difference between\b/i,
  /\bhow many rounds\b/i,
  /\bwhat is home state quota\b/i,
  /\bwhat is other state quota\b/i,
];

const IIT_COUNSELLING_STRATEGY_PATTERNS = [
  /\b(cse|ece|eee|mechanical|mech|civil)\b.*\b(vs|versus|or|ya|leda)\b.*\b(cse|ece|eee|mechanical|mech|civil)\b/i,
  /\bwhich (is better|should i prefer|has better|one is better)\b/i,
  /\bshould i (choose|prioritize|prefer|use)\b/i,
  /\bwhen should i (use|choose) (float|slide|freeze)\b/i,
  /\bwhen should i (float|slide|freeze)\b/i,
  /\bshould i use (float|slide|freeze)\b/i,
  /\bwhich jos+a+a? option is safer\b/i,
  /\biit\b.+\b(nit|trichy|warangal|surathkal|allahabad)\b/i,
  /\b(nit|iit)\b.+\b(cse|ece|eee)\b/i,
  /\bbranch (vs|or) college\b/i,
  /\bprioriti[sz]e branch (or|over) college\b/i,
  /\bcircuit branch/i,
  /\bbranch slid(e|ing)\b/i,
  /\bis branch sliding useful\b/i,
  /\bcommon mistake/i,
  /\bearly round\b/i,
  /\bchoice (list|filling) (order|strategy)\b/i,
  /\bfloat kab\b/i,
  /\bfreeze kab\b/i,
  /\bbranch kaun sa better\b/i,
  /\bkaun sa branch\b/i,
  /\bcse\s+ya\s+ece\b/i,
  /\bcse\s+leda\s+ece\b/i,
  /\bcoding\s+pasand\b/i,
  /\bpasand\s+ho\b/i,
  /\bcoding\s+nachite\b/i,
  /\bnachite\b/i,
  /\bplacements?\s+(vs|or|ya|leda)\s+interest\b/i,
  /\bwhich branch is better\b/i,
  /\bwhat if i like coding\b/i,
  /\bwhich has better placements\b/i,
  /\bwhich is safer\b/i,
  /\bshould i prefer\b/i,
  /\biit or nit\b/i,
  /\biiit\b.*\b(vs|or)\b.*\biit\b/i,
  /\bprefer circuit\b/i,
];

function intentTextCandidates(text, originalText) {
  const candidates = [];
  const normalized = normalizeText(text);
  if (normalized) candidates.push(normalized);
  const original = String(originalText || '').trim();
  if (original && normalizeText(original) !== normalized) {
    candidates.push(normalizeText(original));
    candidates.push(original.toLowerCase());
  }
  return candidates;
}

function isFactualIceDelegation(text, originalText) {
  return intentTextCandidates(text, originalText).some(
    (t) => t && FACTUAL_ICE_DELEGATION_PATTERNS.some((pattern) => pattern.test(t))
  );
}

function isIitCounsellingStrategySessionActive(botState) {
  return Boolean(botState?.context?.iitCounsellingStrategyActive);
}

function isIitCounsellingStrategyShortFollowUp(text, originalText = null) {
  const candidates = intentTextCandidates(text, originalText);
  return candidates.some((t) => {
    if (!t) return false;
    if (isFactualIceDelegation(t, originalText)) return false;
    return (
      /\b(placements?|coding|better|safer|useful|prefer|branch|college|nachite|leda|ya|pasand)\b/i.test(t) ||
      /\bwhat if i\b/i.test(t) ||
      /\bwhich (has|is)\b/i.test(t) ||
      /\bcoding\s+nachite\b/i.test(t) ||
      /^(placements?|coding|branch|college)\s*[.!?]?$/i.test(t)
    );
  });
}

function isIitCounsellingStrategyQuestion(text, originalText = null) {
  if (!isIitCounsellingStrategyEnabled()) {
    return false;
  }
  if (isExcludedFromIitExpert(text, originalText)) {
    return false;
  }
  if (isFactualIceDelegation(text, originalText)) {
    return false;
  }
  return intentTextCandidates(text, originalText).some(
    (t) => t && IIT_COUNSELLING_STRATEGY_PATTERNS.some((pattern) => pattern.test(t))
  );
}

module.exports = {
  isIitCounsellingStrategySessionActive,
  isIitCounsellingStrategyQuestion,
  isIitCounsellingStrategyShortFollowUp,
  isFactualIceDelegation,
};
