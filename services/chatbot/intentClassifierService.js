const { GLOBAL_KEYWORDS } = require('../../constants/chatbotStates');
const {
  isIitCounsellingExpertEnabled,
} = require('./iitCounsellingExpert/iitCounsellingFlags');
const {
  isIitCounsellingExpertSessionActive,
  isIitCounsellingExpertQuestion,
} = require('./iitCounsellingExpert/iitCounsellingIntentService');
const {
  isIitCounsellingStrategyEnabled,
} = require('./iitCounsellingStrategy/iitCounsellingStrategyFlags');
const {
  isFactualIceDelegation,
  isIitCounsellingStrategySessionActive,
  isIitCounsellingStrategyQuestion,
  isIitCounsellingStrategyShortFollowUp,
} = require('./iitCounsellingStrategy/iitCounsellingStrategyIntentService');
const {
  getGuidedFlowByBotState,
  shouldBypassScopeFirewall,
} = require('./guidedFlows/guidedFlowRegistry');
const {
  isCareerCounsellingJourneyEntryQuery,
} = require('./careerCounselling/careerCounsellingIntentService');
const { isCareerCounsellingJourneyEnabled } = require('../../constants/careerCounsellingJourney');
const {
  normalizeText,
  escapeRegExp,
  matchesWordBoundary,
  matchesAny,
  matchesHelpMenuCommand,
  matchesMenuWord,
  matchesMenuCommands,
  matchesStandaloneGreeting,
  matchesMainMenuTrigger,
  MENU_COMMAND_WORDS,
} = require('./intentTextUtils');

const KNOWLEDGE_QUESTION_PATTERNS = [
  /\bwhat is\b/i,
  /\bwhat are\b/i,
  /\bwhat do\b/i,
  /\bhow much\b/i,
  /\bhow does\b/i,
  /\bhow do\b/i,
  /\bhow are\b/i,
  /\bhow is\b/i,
  /\btell me\b/i,
  /\bexplain\b/i,
  /\bwhy should\b/i,
  /\bwhy do i need\b/i,
  /\bwhy i need\b/i,
  /\bwhy do\b/i,
  /\bwho are\b/i,
  /\bwho is\b/i,
  /\bservices\b/i,
  /\bbenefits\b/i,
  /\bdifference\b/i,
  /\bcost\b/i,
  /\bfee\b/i,
  /\bpricing\b/i,
  /\bwant to know\b/i,
  /\bknow about\b/i,
  /\b(tell me|want to know|know) about guidexpert\b/i,
];

const CAPABILITY_QUESTION_PATTERNS = [
  /\bwhat can you do\b/i,
  /\bhow can you help\b/i,
  /\bwhat do you do\b/i,
  /\bwhat all can you do\b/i,
  /\bkya kya kar sakte\b/i,
  /\bkya kar sakte\b/i,
  /\bkitne tarike\b/i,
  /\bkitne tariko\b/i,
  /\bkonse tareeke\b/i,
  /\btum mere liye\b/i,
  /\baap kya kar sakte\b/i,
];

const COUNSELLOR_PROGRAM_PATTERNS = [
  /\b(counselling|counseling) services\b/i,
  /\bwhich program\b/i,
  /\bbenefits of (your )?(counselling|counseling|program|guidance)\b/i,
  /\bhow does the (counselling|counseling) process work\b/i,
  /\bdo you provide\b.*\b(iit counselling|iit counseling|college predict|mentorship|career guidance|counselling|counseling)\b/i,
  /\bwhat is included in (your )?program\b/i,
  /\bhow long does the program\b/i,
  /\bhow (can i join|do i join)\b/i,
  /\b(program|package) fees\b/i,
  /\bhow much.*\bfees\b/i,
  /\bwhat are the fees\b/i,
  /\b(program|package|counselling|counseling)\s+fees\b/i,
  /\bfees for (the )?(program|package|counselling|counseling)\b/i,
  /\b(career|admission) guidance\b/i,
  /\b(iit|college) counselling\b/i,
  /\b(iit|college) counseling\b/i,
  /\bcollege (prediction|predictor) support\b/i,
  /\b(do you (offer|provide)|what).*\bmentor(ship)?\b/i,
  /\bguidexpert (program|services|counselling|counseling)\b/i,
  /\bwhat programs?\b/i,
  /\bhow to join\b/i,
  /\bwhat (counselling|counseling) (programs?|packages?)\b/i,
  /\b(counselling|counseling) (programs?|packages?)\b/i,
  /\bwhat (counselling|counseling) programs?\b/i,
  /\b(tell me|want to know|know) about guidexpert\b/i,
  /^(fees?|fee|price|pricing|cost|benefits?|duration|mentorship|sessions?)\s*[.!?]?$/i,
  /\bfees kya hai\b/i,
  /\bprice kya hai\b/i,
  /\bbenefits kya hai\b/i,
  /\bfees enti\b/i,
  /\bbenefits enti\b/i,
  /\baap kaunse counselling programs provide karte ho\b/i,
  /\bmee counselling programs enti\b/i,
];

const IIT_LEAD_SUPPORT_PATTERNS = [
  /\bmy (session|slot|counselling|counseling|booking|meeting)\b/i,
  /\bassigned expert\b/i,
  /\bmy counsellor\b/i,
  /\bmy counselor\b/i,
  /\bmy bda\b/i,
  /\bmeeting link\b/i,
  /\bwhen is my\b/i,
];

function isKnowledgeSessionActive(botState) {
  return Boolean(botState?.context?.knowledgeAssistantActive);
}

function isCounsellorProgramSessionActive(botState) {
  return Boolean(botState?.context?.counsellorProgramAssistantActive);
}

function isIitLeadSupportQuery(text) {
  const t = String(text || '');
  return IIT_LEAD_SUPPORT_PATTERNS.some((pattern) => pattern.test(t));
}

const GUIDEXPERT_IDENTITY_PATTERNS = [
  /^what is guidexpert\s*[.!?]?$/,
  /^tell me about guidexpert\s*[.!?]?$/,
  /^i want to know about guidexpert\s*[.!?]?$/,
  /^about guidexpert\s*[.!?]?$/,
  /^who are you\s*[.!?]?$/,
  /\bwhat is guidexpert\b/i,
  /\btell me about guidexpert\b/i,
  /\bi want to know about guidexpert\b/i,
  /\b(know|want to know) about guidexpert\b/i,
];

function isGuideXpertIdentityQuestion(text, originalText = null) {
  return intentTextCandidates(text, originalText).some(
    (t) => t && GUIDEXPERT_IDENTITY_PATTERNS.some((pattern) => pattern.test(t))
  );
}

function isCounsellorProgramQuestion(text, originalText = null) {
  if (isIitLeadSupportQuery(text) || isIitLeadSupportQuery(originalText)) {
    return false;
  }
  if (isGuideXpertIdentityQuestion(text, originalText)) {
    return true;
  }
  return intentTextCandidates(text, originalText).some(
    (t) => t && COUNSELLOR_PROGRAM_PATTERNS.some((pattern) => pattern.test(t))
  );
}

const SOCIAL_GREETING_PATTERNS = [
  /^(how are you|how are u|how r u)\s*[.!?]?$/,
  /^(kaise ho aap|kaise ho)\s*[.!?]?$/,
  /^(ela vunnav|ela vunnaru|ela unnaru|bagunnara|bagunnava)\s*[.!?]?$/,
];

const ROMANIZED_TELUGU_GREETING_PATTERNS = [
  /^(ela vunnav|ela vunnaru|ela unnaru|bagunnara|bagunnava)\s*[.!?]?$/,
];

const ROMANIZED_TELUGU_BRANCH_GUIDANCE_PATTERNS = [
  /\bnaaku\s+(cse|ece|eee|it)\s+kavali\b/i,
  /\bnaaku\s+e?\s*branch\s+manchidi\b/i,
  /\bbranch\s+(enti|bagundhi|bagunda|manchidi)\b/i,
  /\bsoftware\s+(jobs?|engineer)\b/i,
  /\bkosam\s+branch\b/i,
  /\bnenu\s+software\s+engineer\s+avvali\b/i,
  /\b(cse|ece|eee|it)\s+kavali\b/i,
];

const NATIVE_GREETING_PHRASES = [
  { pattern: /^(మీరు|నేను).*(ఎలా|ఉన్న|బాగ)/u },
  { pattern: /^(आप\s*कैसे|कैसे\s*हैं|आप\s*कैस)/u },
  { pattern: /^(तुम्ही\s*कसे|कसे\s*आहात)/u },
  { pattern: /^(நீங்கள்\s*எப்படி|எப்படி\s*இர)/u },
  { pattern: /^(ನೀವು\s*ಹೇಗ|ಹೇಗಿದ್ದ)/u },
  { pattern: /^(നിങ്ങൾക്ക്\s*സുഖ|സുഖമാണ)/u },
  { pattern: /^(আপনি\s*কেমন|কেমন\s*আছ)/u },
];

function isNativeSocialGreeting(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return NATIVE_GREETING_PHRASES.some(({ pattern }) => pattern.test(raw));
}

function isSocialGreeting(text, originalText = null) {
  const candidates = [normalizeText(text)];
  if (originalText) candidates.push(normalizeText(originalText));
  return candidates.some(
    (t) => t && SOCIAL_GREETING_PATTERNS.some((pattern) => pattern.test(t))
  );
}

function isRomanizedTeluguSocialGreeting(text) {
  const raw = String(text || '').trim();
  const t = normalizeText(raw);
  if (!t || !isRomanizedAscii(raw)) return false;
  return ROMANIZED_TELUGU_GREETING_PATTERNS.some((pattern) => pattern.test(t));
}

function logIntentDebug(payload) {
  if (String(process.env.CHATBOT_INTENT_DEBUG || '').trim() !== '1') return;
  console.log('[INTENT_DEBUG]', JSON.stringify(payload));
}

function isRomanizedAscii(text) {
  const t = String(text || '').trim();
  return t.length > 0 && /^[\x00-\x7F]+$/.test(t);
}

function isRomanizedTeluguBranchGuidanceQuery(text) {
  const t = normalizeText(text);
  if (!t || !isRomanizedAscii(t)) return false;
  return ROMANIZED_TELUGU_BRANCH_GUIDANCE_PATTERNS.some((pattern) => pattern.test(t));
}

function intentTextCandidates(text, originalText = null) {
  const normalized = normalizeText(text);
  const original = originalText ? normalizeText(originalText) : null;
  if (original && original !== normalized) {
    return [normalized, original];
  }
  return [normalized];
}

/**
 * General knowledge / exploratory questions routed to the Knowledge Assistant.
 * @param {string} text - normalized (lowercase, collapsed spaces)
 */
function isKnowledgeQuestion(text) {
  const t = String(text || '').trim();
  if (!t || /^\d+$/.test(t)) {
    return false;
  }
  return KNOWLEDGE_QUESTION_PATTERNS.some((pattern) => pattern.test(t));
}

function isCapabilityQuestion(text, originalText = null) {
  return intentTextCandidates(text, originalText).some(
    (t) => t && CAPABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(t))
  );
}

const BRANCH_SIGNAL_PATTERN =
  /\b(cse|ece|eee|mech|civil|it|branch|branches)\b/i;

const MIXED_RANK_BRANCH_PATTERNS = [
  /\bcan\s+i\s+get\s+(cse|ece|eee|it|mech|civil)\s+with\s+rank\s+\d+/i,
  /\b(cse|ece|eee|it|mech|civil)\s+with\s+rank\s+\d+/i,
  /\brank\s+(ki|tho|lo)\s+(cse|ece|eee|it|branch)\b/i,
  /\b\d{3,}\s+rank\s+(ki|tho|lo)\s+(cse|ece|eee|it|branch)\b/i,
  /\bmujhe\s+(cse|ece|eee|it)\s+(?:\d{3,}\s*)?rank\s+(?:par|pe|mein)\b/i,
  /\bmeri\s+rank\b/i,
  /\b\d{3,}\s*(rank|rayank|[\u0c30\u0c4d\u0c2f\u0c3e\u0c02\u0c15])[^\s]*\s*(tho|lo|ki|\u0c24\u0c4b)\s*(cse|ece|eee|it)\b/i,
  /\b\d{3,}\s*[\u0c00-\u0c7f]+[^\s]*\s*(cse|ece|eee|it)\b/i,
];

const MARKS_SIGNAL_PATTERN =
  /\b(marks?|score|scored|percentile|vachayi|vachindi|aaye|hai|labh|labham|labhamu)\b/i;

const EXAM_SIGNAL_PATTERN =
  /\b(jee main|jee advanced|jee|kcet|keam|ap eamcet|ts eamcet|eamcet|tnea|wbjee|mht cet|mhtcet)\b/i;

function hasRankSignal(text) {
  const t = String(text || '');
  if (/\b(rank|percentile|ranku|rayank|rayanku)\b/i.test(t)) return true;
  if (/\u0c30\u0c4d\u0c2f\u0c3e\u0c02\u0c15/i.test(t)) return true;
  if (/\u0bb0\u0bc7\u0b99\u0bcd\u0b95/i.test(t)) return true;
  if (/\u0cb0\u0cc6\u0c82\u0c95/i.test(t)) return true;
  if (/\bmeri\s+rank\b/i.test(t)) return true;
  if (/\brank\s+(ki|tho|lo)\b/i.test(t)) return true;
  if (/\b\d{3,}\b/.test(t) && /\brank\b/i.test(t)) return true;
  return false;
}

function hasBranchSignal(text) {
  return BRANCH_SIGNAL_PATTERN.test(String(text || ''));
}

/**
 * Marks / score queries — route to Rank Predictor (exam asked if missing).
 * Beats Knowledge Assistant session when active.
 */
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

/**
 * Rank + branch admission queries — route to College Predictor
 * even when a Knowledge Assistant session is active.
 */
function isRankBranchCollegePredictorQuery(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    if (isMarksBasedRankPredictorQuery(t)) return false;
    if (isRomanizedTeluguBranchGuidanceQuery(t)) return false;
    if (MIXED_RANK_BRANCH_PATTERNS.some((pattern) => pattern.test(t))) {
      return true;
    }
    return hasRankSignal(t) && hasBranchSignal(t);
  });
}

/** @deprecated Use isRankBranchCollegePredictorQuery */
function isRankBranchRecommendationQuery(text) {
  return isRankBranchCollegePredictorQuery(text);
}

/**
 * Rule-based intent classification (Phase 1).
 * @returns {{ intent: string, confidence: 'high'|'medium'|'low' }}
 */
function classifyIntent(text, botState, productLine, originalText = null) {
  const t = normalizeText(text);
  const original = String(originalText || text || '').trim();

  if (
    matchesAny(t, GLOBAL_KEYWORDS.agent) &&
    !isCounsellorProgramQuestion(t, original)
  ) {
    return { intent: 'human_handoff', confidence: 'high' };
  }
  if (matchesMainMenuTrigger(t)) {
    return { intent: 'main_menu', confidence: 'high' };
  }
  if (matchesAny(t, GLOBAL_KEYWORDS.cancel)) {
    return { intent: 'main_menu', confidence: 'high' };
  }
  if (matchesAny(t, GLOBAL_KEYWORDS.stop)) {
    return { intent: 'opt_out', confidence: 'high' };
  }

  const activeGuidedFlow = getGuidedFlowByBotState(botState?.state);
  if (activeGuidedFlow) {
    return { intent: activeGuidedFlow.continueIntent, confidence: 'high' };
  }

  const nativeGreeting = isNativeSocialGreeting(original);
  const socialGreeting = isSocialGreeting(t, original);
  const romanizedTeluguGreeting =
    isRomanizedTeluguSocialGreeting(original) || isRomanizedTeluguSocialGreeting(t);

  logIntentDebug({
    stage: 'classifyIntent',
    message: original,
    intentText: t,
    isSocialGreeting: socialGreeting,
    isNativeSocialGreeting: nativeGreeting,
    romanizedTeluguGreeting,
  });

  if (nativeGreeting || socialGreeting) {
    const intentReason = romanizedTeluguGreeting ? 'romanized_telugu_greeting' : 'social_greeting';
    logIntentDebug({ message: original, intent: 'greeting', reason: intentReason });
    return { intent: 'greeting', confidence: 'high', intentReason };
  }

  if (isIitCounsellingExpertEnabled() && isFactualIceDelegation(t, original)) {
    const inStrategySession =
      isIitCounsellingStrategyEnabled() && isIitCounsellingStrategySessionActive(botState);
    const inIceSession = isIitCounsellingExpertSessionActive(botState);
    if (inStrategySession || !inIceSession) {
      return {
        intent: 'iit_counselling_expert',
        confidence: 'medium',
        intentReason: 'iit_counselling_factual_delegation',
      };
    }
  }

  if (isGuideXpertIdentityQuestion(t, original)) {
    return {
      intent: 'counsellor_program_assistant',
      confidence: 'medium',
      intentReason: 'guidexpert_identity_question',
    };
  }

  if (isMarksBasedRankPredictorQuery(t, original)) {
    return { intent: 'rank_predictor', confidence: 'high', intentReason: 'marks_based_rank_query' };
  }

  if (
    isCareerCounsellingJourneyEnabled() &&
    isCareerCounsellingJourneyEntryQuery(t, original)
  ) {
    return {
      intent: 'career_counselling_journey',
      confidence: 'high',
      intentReason: 'career_counselling_journey_entry',
    };
  }

  if (isRankBranchCollegePredictorQuery(t, original)) {
    return { intent: 'college_predictor', confidence: 'high', intentReason: 'rank_branch_college_query' };
  }

  if (isRomanizedTeluguBranchGuidanceQuery(original) || isRomanizedTeluguBranchGuidanceQuery(t)) {
    return {
      intent: 'knowledge_assistant',
      confidence: 'medium',
      intentReason: 'romanized_telugu_branch_guidance',
    };
  }

  if (
    isIitCounsellingStrategyEnabled() &&
    isIitCounsellingStrategySessionActive(botState) &&
    (isIitCounsellingStrategyQuestion(t, original) ||
      isIitCounsellingStrategyShortFollowUp(t, original))
  ) {
    return {
      intent: 'iit_counselling_strategy',
      confidence: 'medium',
      intentReason: 'iit_counselling_strategy_session_active',
    };
  }

  if (isIitCounsellingStrategyQuestion(t, original)) {
    return {
      intent: 'iit_counselling_strategy',
      confidence: 'medium',
      intentReason: 'iit_counselling_strategy_question',
    };
  }

  if (isIitCounsellingExpertEnabled() && isIitCounsellingExpertSessionActive(botState)) {
    return {
      intent: 'iit_counselling_expert',
      confidence: 'medium',
      intentReason: 'iit_counselling_session_active',
    };
  }

  if (isIitCounsellingExpertQuestion(t, original)) {
    return {
      intent: 'iit_counselling_expert',
      confidence: 'medium',
      intentReason: 'iit_counselling_question',
    };
  }

  if (isCounsellorProgramSessionActive(botState)) {
    const programTopicSignal =
      /\b(fees?|benefits?|mentorship|counsell?ing|counseling|programs?|packages?|duration|join|iit|guidexpert)\b/i;
    if (
      isKnowledgeQuestion(t) &&
      !isCounsellorProgramQuestion(t, original) &&
      !isGuideXpertIdentityQuestion(t, original) &&
      !programTopicSignal.test(t) &&
      !programTopicSignal.test(original)
    ) {
      return {
        intent: 'knowledge_assistant',
        confidence: 'medium',
        intentReason: 'knowledge_breakout_from_cpa_session',
      };
    }
    return {
      intent: 'counsellor_program_assistant',
      confidence: 'medium',
      intentReason: 'counsellor_program_session_active',
    };
  }

  if (isCounsellorProgramQuestion(t, original)) {
    return {
      intent: 'counsellor_program_assistant',
      confidence: 'medium',
      intentReason: 'counsellor_program_question',
    };
  }

  if (isKnowledgeSessionActive(botState)) {
    return { intent: 'knowledge_assistant', confidence: 'medium' };
  }

  if (isCapabilityQuestion(t, original)) {
    return {
      intent: 'knowledge_assistant',
      confidence: 'medium',
      intentReason: 'capability_question',
    };
  }

  if (/^again$/.test(t)) {
    return { intent: 'college_predictor', confidence: 'high' };
  }

  if (productLine === 'iit_counselling') {
    if (/^1$/.test(t)) return { intent: 'lead_lookup', confidence: 'high' };
    if (/^2$/.test(t)) return { intent: 'counselling_support', confidence: 'high' };
    if (/^3$/.test(t)) return { intent: 'assigned_expert', confidence: 'high' };
    if (/^4$/.test(t)) return { intent: 'rank_predictor', confidence: 'high' };
    if (/^5$/.test(t)) return { intent: 'college_predictor', confidence: 'high' };
    if (/^6$/.test(t)) return { intent: 'human_handoff', confidence: 'high' };
  }

  if (productLine === 'guidexpert') {
    if (/^[1-5]$/.test(t)) return { intent: 'faq', confidence: 'high' };
    if (/^6$/.test(t)) return { intent: 'human_handoff', confidence: 'high' };
  }

  if (productLine === 'unknown') {
    if (/^1$/.test(t)) return { intent: 'counselling_support', confidence: 'high' };
    if (/^2$/.test(t)) return { intent: 'demo_support', confidence: 'high' };
    if (/^3$/.test(t)) return { intent: 'rank_predictor', confidence: 'high' };
    if (/^4$/.test(t)) return { intent: 'human_handoff', confidence: 'high' };
  }

  if (isKnowledgeQuestion(t)) {
    return { intent: 'knowledge_assistant', confidence: 'medium' };
  }

  if (/^1$|my details|my booking|my slot|profile/.test(t)) {
    return { intent: 'lead_lookup', confidence: 'high' };
  }
  if (/^2$|faq|question|help me/.test(t)) {
    return { intent: 'faq', confidence: 'high' };
  }
  if (/\b(predict rank|rank predictor)\b/i.test(t)) {
    return { intent: 'rank_predictor', confidence: 'high', intentReason: 'explicit_rank_predictor_entry' };
  }
  if (/^4$|college|which college|colleges/.test(t)) {
    return { intent: 'college_predictor', confidence: 'medium' };
  }
  if (/^5$|agent|human|talk/.test(t)) {
    return { intent: 'human_handoff', confidence: 'high' };
  }

  if (productLine === 'iit_counselling') {
    if (/assigned expert|my counsellor|my bda|who is my expert/.test(t)) {
      return { intent: 'assigned_expert', confidence: 'high' };
    }
    if (/iit|counselling|counseling|session|slot|telugu|hindi|bda/.test(t)) {
      return { intent: 'counselling_support', confidence: 'medium' };
    }
  }

  if (productLine === 'guidexpert' || productLine === 'unknown') {
    if (/demo|meet|meeting|slot|register/.test(t)) {
      return { intent: 'demo_support', confidence: 'medium' };
    }
  }

  if (/when|what time|meeting link|reminder|whatsapp/.test(t)) {
    if (productLine === 'iit_counselling') {
      return { intent: 'counselling_support', confidence: 'medium' };
    }
    return { intent: 'demo_support', confidence: 'medium' };
  }

  return { intent: 'unknown', confidence: 'low' };
}

module.exports = {
  classifyIntent,
  normalizeText,
  shouldBypassScopeFirewall,
  isKnowledgeQuestion,
  isCapabilityQuestion,
  isCounsellorProgramQuestion,
  isGuideXpertIdentityQuestion,
  isCounsellorProgramSessionActive,
  isIitLeadSupportQuery,
  isIitCounsellingExpertEnabled,
  isKnowledgeSessionActive,
  isNativeSocialGreeting,
  isSocialGreeting,
  isRomanizedTeluguSocialGreeting,
  isRomanizedTeluguBranchGuidanceQuery,
  isMarksBasedRankPredictorQuery,
  isRankBranchCollegePredictorQuery,
  isRankBranchRecommendationQuery,
  isCareerCounsellingJourneyEntryQuery,
  hasRankSignal,
  hasBranchSignal,
  intentTextCandidates,
};
