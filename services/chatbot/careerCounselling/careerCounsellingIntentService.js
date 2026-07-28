'use strict';

const { normalizeText } = require('../intentTextUtils');

function intentTextCandidates(text, originalText = null) {
  const normalized = normalizeText(text);
  const original = originalText ? normalizeText(originalText) : null;
  if (original && original !== normalized) {
    return [normalized, original];
  }
  return [normalized];
}

const CAREER_COUNSELLING_ENTRY_PATTERNS = [
  /\bi need counselling\b/i,
  /\bi need counseling\b/i,
  /\bhelp me choose (a |my )?college\b/i,
  /\bhelp me choose my future\b/i,
  /\bsuggest (a |some )?college\b/i,
  /\bwhich college should i join\b/i,
  /\b(which|what) college (is|would be) (good|best|right|better)\b/i,
  /\bconfused after intermediate\b/i,
  /\b(i am|i'm) confused after intermediate\b/i,
  /\bcareer guidance\b/i,
  /\badmission guidance\b/i,
  /\bi need career guidance\b/i,
  /\b(i am|i'm) confused\b/i,
  /\bi don't know which college\b/i,
  /\bdon't know which college\b/i,
  /\bplease help\b/i,
  /\bneed help choosing\b/i,
  /\bhow (do i|to) choose (a |the |my )?college\b/i,
  /\bchoose (the )?right college\b/i,
  /\bguide me (to|in) choose\b/i,
  /\bcollege (selection|choosing) help\b/i,
];

const BRANCH_SIGNAL_PATTERN =
  /\b(cse|ece|eee|mech|civil|it|branch|branches)\b/i;

const MARKS_SIGNAL_PATTERN =
  /\b(marks?|score|scored|percentile|vachayi|vachindi|aaye|hai|labh|labham|labhamu)\b/i;

const EXAM_SIGNAL_PATTERN =
  /\b(jee main|jee advanced|jee|kcet|keam|ap eamcet|ts eamcet|eamcet|tnea|wbjee|mht cet|mhtcet)\b/i;

const BREAKOUT_DURING_JOURNEY_PATTERNS = [
  /\b(predict rank|rank predictor|college predictor)\b/i,
  /\bpredict my rank\b/i,
  /\bmy rank is\b/i,
];

function hasRankSignal(text) {
  const t = String(text || '');
  if (/\b(rank|percentile|ranku|rayank|rayanku)\b/i.test(t)) return true;
  if (/\bmeri\s+rank\b/i.test(t)) return true;
  if (/\brank\s+(ki|tho|lo)\b/i.test(t)) return true;
  if (/\b\d{3,}\b/.test(t) && /\brank\b/i.test(t)) return true;
  return false;
}

function hasBranchSignal(text) {
  return BRANCH_SIGNAL_PATTERN.test(String(text || ''));
}

function isMarksBasedRankPredictorQuery(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t || !/\d+(\.\d+)?/.test(t)) return false;
    if (hasRankSignal(t) && hasBranchSignal(t)) return false;
    if (hasRankSignal(t) && !MARKS_SIGNAL_PATTERN.test(t)) return false;
    if (MARKS_SIGNAL_PATTERN.test(t) && EXAM_SIGNAL_PATTERN.test(t)) return true;
    if (MARKS_SIGNAL_PATTERN.test(t) && /\b\d+(\.\d+)?\b/.test(t)) return true;
    if (EXAM_SIGNAL_PATTERN.test(t) && /\b\d+(\.\d+)?\b/.test(t) && !hasRankSignal(t)) {
      return true;
    }
    return false;
  });
}

function isRankBranchCollegePredictorQuery(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    if (isMarksBasedRankPredictorQuery(t)) return false;
    return hasRankSignal(t) && hasBranchSignal(t);
  });
}

function isCareerCounsellingJourneyEntryQuery(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    if (isRankBranchCollegePredictorQuery(t, originalText)) return false;
    if (isMarksBasedRankPredictorQuery(t, originalText)) return false;
    if (/\brank\s+\d{3,}/i.test(t) && /\b(college|branch|cse|ece|eee|it|mech)\b/i.test(t)) {
      return false;
    }
    return CAREER_COUNSELLING_ENTRY_PATTERNS.some((pattern) => pattern.test(t));
  });
}

function isCareerCounsellingJourneyBreakout(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    if (isRankBranchCollegePredictorQuery(t, originalText)) return true;
    if (isMarksBasedRankPredictorQuery(t, originalText)) return true;
    return BREAKOUT_DURING_JOURNEY_PATTERNS.some((pattern) => pattern.test(t));
  });
}

function isPermissionYes(text) {
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|y|show me|suggest|go ahead|absolutely|definitely)\b/i.test(
    t
  );
}

function isPermissionNo(text) {
  const t = normalizeText(text);
  return /^(no|nope|not now|later|nah|n)\b/i.test(t);
}

module.exports = {
  CAREER_COUNSELLING_ENTRY_PATTERNS,
  isCareerCounsellingJourneyEntryQuery,
  isCareerCounsellingJourneyBreakout,
  isPermissionYes,
  isPermissionNo,
};
