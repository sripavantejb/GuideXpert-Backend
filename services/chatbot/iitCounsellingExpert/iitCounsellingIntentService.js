'use strict';

const { isIitCounsellingExpertEnabled } = require('./iitCounsellingFlags');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const IIT_LEAD_SUPPORT_EXCLUSIONS = [
  /\bmy (session|slot|counselling|counseling|booking|meeting)\b/i,
  /\bassigned expert\b/i,
  /\bmy counsellor\b/i,
  /\bmy counselor\b/i,
  /\bmy bda\b/i,
  /\bmeeting link\b/i,
  /\bwhen is my\b/i,
];

const CPA_SERVICE_EXCLUSIONS = [
  /\bdo you provide\b.*\b(counselling|counseling|iit counselling|iit counseling)\b/i,
  /\bwhat (counselling|counseling) (programs?|services?|packages?)\b/i,
  /\bguidexpert (program|services|fees|benefits)\b/i,
  /\bhow (can i join|do i join)\b/i,
  /\b(program|package) fees\b/i,
];

const IIT_COUNSELLING_EXPERT_PATTERNS = [
  /\bjos+a+a?\b/i,
  /\bcsab\b/i,
  /\bwhat is jos+a+a?\b/i,
  /\bwhat is csab\b/i,
  /\bdifference between iit and nit\b/i,
  /\biit vs nit\b/i,
  /\bwhich iit is best\b/i,
  /\bbranch slid(e|ing)\b/i,
  /\bfreez(e|ing)\b/i,
  /\bfloat(ing)?\b/i,
  /\bopening (and )?closing ranks?\b/i,
  /\bhow many rounds\b/i,
  /\bhome state quota\b/i,
  /\bother state quota\b/i,
  /\bcrl rank\b/i,
  /\bobc-?ncl rank\b/i,
  /\bseat allocation\b/i,
  /\bcounselling round\b/i,
  /\bcounseling round\b/i,
  /\bjosaa kya hai\b/i,
  /\bcsab kya hai\b/i,
  /\brounds kitne\b/i,
  /\bfloat ante enti\b/i,
  /\bslide ante enti\b/i,
  /\bfreeze ante enti\b/i,
  /\bquota enti\b/i,
  /^(rounds?|float|slide|freeze|quota)\s*[.!?]?$/i,
  /\bwhat is float\b/i,
  /\bwhat is slide\b/i,
  /\bwhat is freeze\b/i,
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

function isExcludedFromIitExpert(text, originalText) {
  const candidates = intentTextCandidates(text, originalText);
  return candidates.some(
    (t) =>
      t &&
      (IIT_LEAD_SUPPORT_EXCLUSIONS.some((p) => p.test(t)) ||
        CPA_SERVICE_EXCLUSIONS.some((p) => p.test(t)))
  );
}

function isIitCounsellingExpertSessionActive(botState) {
  return Boolean(botState?.context?.iitCounsellingExpertActive);
}

function isIitCounsellingShortFollowUp(text, originalText = null) {
  const candidates = intentTextCandidates(text, originalText);
  return candidates.some((t) => {
    if (!t) return false;
    if (/^(rounds?|float|slide|freeze|quota)\s*[.!?]?$/i.test(t)) return true;
    return /\b(how many rounds|what is float|what is slide|what is freeze|rounds kitne|float ante enti|slide ante enti)\b/i.test(
      t
    );
  });
}

function isIitCounsellingExpertQuestion(text, originalText = null) {
  if (!isIitCounsellingExpertEnabled()) {
    return false;
  }
  if (isExcludedFromIitExpert(text, originalText)) {
    return false;
  }
  return intentTextCandidates(text, originalText).some(
    (t) => t && IIT_COUNSELLING_EXPERT_PATTERNS.some((pattern) => pattern.test(t))
  );
}

module.exports = {
  isIitCounsellingExpertSessionActive,
  isIitCounsellingExpertQuestion,
  isIitCounsellingShortFollowUp,
  isExcludedFromIitExpert,
};
