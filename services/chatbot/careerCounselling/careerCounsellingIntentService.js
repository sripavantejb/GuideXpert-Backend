'use strict';

/**
 * Career Counselling V2 entry intent — confidence-based admissions guidance routing.
 * Prefer counseling over knowledge/LLM/guardrail fallback whenever the student
 * expresses college/course/career decision uncertainty.
 */

const { normalizeText } = require('../intentTextUtils');

function intentTextCandidates(text, originalText = null) {
  const normalized = normalizeText(text);
  const original = originalText ? normalizeText(originalText) : null;
  if (original && original !== normalized) {
    return [normalized, original];
  }
  return [normalized];
}

/** Explicit high-confidence entry phrases (legacy + expanded). */
const CAREER_COUNSELLING_ENTRY_PATTERNS = [
  /\bi need counselling\b/i,
  /\bi need counseling\b/i,
  /\bi need career (guidance|advice|counselling|counseling)\b/i,
  /\bneed (career )?(guidance|advice)\b/i,
  /\bcareer (guidance|advice|counselling|counseling)\b/i,
  /\badmission guidance\b/i,
  /\badmissions? help\b/i,
  /\bhelp me choose (a |my |the )?(college|course|branch|future|career)\b/i,
  /\bhelp me (pick|select|decide|find) (a |my |the )?(college|course|branch)\b/i,
  /\bhelp me choose\b/i,
  /\bhelp (me )?choosing\b/i,
  /\bneed help (choosing|deciding|picking|selecting|finding)\b/i,
  /\bi need help deciding\b/i,
  /\bneed help deciding\b/i,
  /\bsuggest (a |some |me )?(college|course|branch|option|options)\b/i,
  /\brecommend (a |some |me )?(college|course|branch|option|options)\b/i,
  /\b(any |some )?college suggestion(s)?\b/i,
  /\b(any |some )?college recommend/i,
  /\bsuggest something\b/i,
  /\brecommend something\b/i,
  /\bwant counsell?ing\b/i,
  /\bstart counsell?ing\b/i,
  /\bis engineering good for me\b/i,
  /\bshould i take engineering\b/i,
  /\b(branch|course) confusion\b/i,
  /\bcnfused\b/i,
  /\b(good |best )?college(s)? (kavali|cheppandi|suggest|suggestion)\b/i,
  /\b(college|course|branch) (kavali|cheyali|cheyyali)\b/i,
  /\bi want (to (do|take|join) )?engineering\b/i,
  /\bwant engineering\b/i,
  /\bparents? (are )?(forcing|pressur(?:e|ing)|want|telling)\b/i,
  /\b(parent|parents) want me\b/i,
  /\bi got (a |my )?rank\b/i,
  /\bmy future\b/i,
  /\bdropout\b/i,
  /^(cse|ece|eee|it|aiml|ai\/?ml|ai|mech|civil|cs)(?:\s+(?:please|ahora|yaar|bro|urgently|sir|madam|bhai|ji|help|kavali|cheppandi))?[.!?\s🙏]*$/i,
  /\btopper\b.*\b(confused|college|iit|private)\b/i,
  /\blow rank\b/i,
  /\bwhich college should i (join|choose|pick|select|take)\b/i,
  /\b(which|what) college (is|would be|should i)\b/i,
  /\bwhich college\b/i,
  /\bwhich course (is|should|would|to)\b/i,
  /\bwhich course\b/i,
  /\bwhich (engineering )?branch\b/i,
  /\bwhat should i choose\b/i,
  /\bwhat is best for me\b/i,
  /\bwhat'?s best for me\b/i,
  /\bconfused (to|about|in|with|on)?\s*(find|finding|choose|choosing|select|pick)?/i,
  /\b(i am|i'm) confused\b/i,
  /\bconfused after intermediate\b/i,
  /\b(i am|i'm) lost\b/i,
  /\bi'?m lost\b/i,
  /\b(i am|i'm) worried\b/i,
  /\bi don'?t know which (college|course|branch)\b/i,
  /\bdon'?t know which (college|course|branch)\b/i,
  /\bi don'?t know what to do\b/i,
  /\bdon'?t know what to do\b/i,
  /\bi don'?t know what to do after intermediate\b/i,
  /\bafter intermediate\b/i,
  /\bplease help\b/i,
  /\bcan you help me\b/i,
  /\bcan u help me\b/i,
  /\bhow (do i|to) choose (a |the |my )?(college|course|branch)\b/i,
  /\bchoose (the )?right (college|course|branch)\b/i,
  /\bguide me\b/i,
  /\bcollege (selection|choosing|guidance) help\b/i,
  /\bi want a good future\b/i,
  /\bgood future\b/i,
  /\bfind (a |the )?college\b/i,
  /\blooking for (a )?college\b/i,
  /\bneed (a )?college suggestion\b/i,
  /\bcounselling for college\b/i,
  /\bcounseling for college\b/i,
];

/** Soft lexical signals — combined for medium confidence. */
const CONFUSION_SIGNAL =
  /\b(confused|confusion|confusing|lost|worried|worry|unsure|doubt|doubts|stress|stressed|anxious|help|guidance|guide|advise|advice|suggest(?:ion|ions|ed|ing)?|recommend(?:ation|ations|ed|ing)?|don'?t know|do not know|no idea|not sure|what should i|which (college|course|branch)|best for me|decide|deciding|decision|choose|choosing|pick|select|find(?:ing)? a college|looking for college|career|admission|admissions|future|after intermediate|after 12th|after inter|counsell?ing|forcing|pressure|dropout|engineering)\b/i;

const DOMAIN_SIGNAL =
  /\b(college|colleges|course|courses|branch|branches|career|careers|admission|admissions|engineering|b\.?tech|intermediate|inter|mpc|bipc|degree|counsell?ing|counseling|placements?|internships?|coding|hostel|campus|affordable|fees|research|future|exam|eamcet|eapcet|jee|suggestion|suggestions)\b/i;

const SOFT_STANDALONE =
  /^(i'?m\s+)?(confused|lost|worried|unsure|help|help me|please help|can you help(?: me)?|guide me|need guidance|need advice|suggest something|recommend something|what should i (do|choose)|i don'?t know|don'?t know|want counsell?ing|start counsell?ing)[.!?]*$/i;

/** Student is uncertain about choosing or finding the right college — drives empathetic opening copy. */
const COLLEGE_SELECTION_CONFUSION_PATTERNS = [
  /\bconfused\b.*\b(college|colleges|select|choose|pick|find|decide|decision|right)\b/i,
  /\b(college|colleges|select|choose|pick|find|decide|decision|right)\b.*\bconfused\b/i,
  /\bconfused (to|about|in|with|on)?\s*(find|finding|choose|choosing|select|selecting|pick|decide|deciding)/i,
  /\bdon'?t know which college\b/i,
  /\bnot sure which college\b/i,
  /\bhelp me choose (a |my |the )?college\b/i,
  /\bhelp me (pick|select|find|decide) (a |my |the )?college\b/i,
  /\bwhich college should i (join|choose|pick|select|take)\b/i,
  /\bchoose (the )?right college\b/i,
  /\bselect (the )?right college\b/i,
  /\bfind (a |the )?right college\b/i,
  /\bconfused after intermediate\b/i,
  /\bconfused after (12th|inter|intermediate)\b/i,
];

const BRANCH_SIGNAL_PATTERN =
  /\b(cse|ece|eee|mech|civil|it|aiml|ai\/?ml|ai|branch|branches)\b/i;

const MARKS_SIGNAL_PATTERN =
  /\b(marks?|score|scored|percentile|vachayi|vachindi|aaye|hai|labh|labham|labhamu)\b/i;

const EXAM_SIGNAL_PATTERN =
  /\b(jee main|jee advanced|jee|kcet|keam|ap eamcet|ap eapcet|ts eamcet|eamcet|tnea|wbjee|mht cet|mhtcet)\b/i;

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

function isPredictorOwnedQuery(text, originalText = null) {
  if (isRankBranchCollegePredictorQuery(text, originalText)) return true;
  if (isMarksBasedRankPredictorQuery(text, originalText)) return true;
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    if (/\brank\s+\d{3,}/i.test(t) && /\b(college|branch|cse|ece|eee|it|mech)\b/i.test(t)) {
      return true;
    }
    return false;
  });
}

/**
 * Score how strongly the utterance is admissions / college / career guidance.
 * @returns {{ score: number, confidence: 'high'|'medium'|'low'|'none', reason: string|null }}
 */
function scoreCareerCounsellingGuidance(text, originalText = null) {
  if (isPredictorOwnedQuery(text, originalText)) {
    return { score: 0, confidence: 'none', reason: 'predictor_owned' };
  }

  let best = { score: 0, confidence: 'none', reason: null };

  for (const t of intentTextCandidates(text, originalText)) {
    if (!t) continue;

    for (const pattern of CAREER_COUNSELLING_ENTRY_PATTERNS) {
      if (pattern.test(t)) {
        return { score: 95, confidence: 'high', reason: 'career_counselling_pattern' };
      }
    }

    if (SOFT_STANDALONE.test(t)) {
      const soft = { score: 80, confidence: 'high', reason: 'career_counselling_soft_standalone' };
      if (soft.score > best.score) best = soft;
    }

    const hasConfusion = CONFUSION_SIGNAL.test(t);
    const hasDomain = DOMAIN_SIGNAL.test(t);
    if (hasConfusion && hasDomain) {
      const combo = { score: 88, confidence: 'high', reason: 'career_counselling_confusion_domain' };
      if (combo.score > best.score) best = combo;
    } else if (hasConfusion) {
      const confOnly = { score: 72, confidence: 'medium', reason: 'career_counselling_confusion' };
      if (confOnly.score > best.score) best = confOnly;
    } else if (hasDomain && /\b(help|guide|suggest|recommend|advice|choose|which|best)\b/i.test(t)) {
      const domainHelp = { score: 78, confidence: 'medium', reason: 'career_counselling_domain_help' };
      if (domainHelp.score > best.score) best = domainHelp;
    }
  }

  return best;
}

function isCareerCounsellingJourneyEntryQuery(text, originalText = null) {
  const scored = scoreCareerCounsellingGuidance(text, originalText);
  return scored.score >= 60;
}

function isCollegeSelectionConfusionEntry(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    return COLLEGE_SELECTION_CONFUSION_PATTERNS.some((pattern) => pattern.test(t));
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
  COLLEGE_SELECTION_CONFUSION_PATTERNS,
  scoreCareerCounsellingGuidance,
  isCareerCounsellingJourneyEntryQuery,
  isCollegeSelectionConfusionEntry,
  isCareerCounsellingJourneyBreakout,
  isPermissionYes,
  isPermissionNo,
};
