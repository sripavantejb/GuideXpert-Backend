const { GLOBAL_KEYWORDS } = require('../../constants/chatbotStates');

const MENU_COMMAND_WORDS = ['menu', 'help', 'start'];

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesWordBoundary(text, word) {
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  return pattern.test(text);
}

function matchesAny(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

function matchesHelpMenuCommand(text) {
  return /^(help|help menu)\s*[.!?]?$/.test(String(text || '').trim());
}

function matchesMenuWord(text, word) {
  if (word === 'help') {
    return matchesHelpMenuCommand(text);
  }
  return matchesWordBoundary(text, word);
}

function matchesMenuCommands(text) {
  return MENU_COMMAND_WORDS.some((word) => matchesMenuWord(text, word));
}

/** Whole message only — avoids substring false positives (e.g. "they" vs "hey"). */
function matchesStandaloneGreeting(text) {
  return /^(hi|hello|hey|hola|namaste|start)$/.test(text);
}

function matchesMainMenuTrigger(text) {
  return matchesMenuCommands(text) || matchesStandaloneGreeting(text);
}

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
];

function isKnowledgeSessionActive(botState) {
  return Boolean(botState?.context?.knowledgeAssistantActive);
}

const SOCIAL_GREETING_PATTERNS = [
  /^(how are you|how are u|how r u)\s*[.!?]?$/,
  /^(kaise ho aap|kaise ho)\s*[.!?]?$/,
  /^(ela vunnaru|ela unnaru)\s*[.!?]?$/,
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

function isSocialGreeting(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return SOCIAL_GREETING_PATTERNS.some((pattern) => pattern.test(t));
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

const BRANCH_SIGNAL_PATTERN =
  /\b(cse|ece|eee|mech|civil|it|branch|branches)\b/i;

const MIXED_RANK_BRANCH_PATTERNS = [
  /\bcan\s+i\s+get\s+(cse|ece|eee|it|mech|civil)\s+with\s+rank\s+\d+/i,
  /\b(cse|ece|eee|it|mech|civil)\s+with\s+rank\s+\d+/i,
  /\brank\s+(ki|tho|lo)\s+(cse|ece|eee|it|branch)\b/i,
  /\b(cse|ece|eee|it)\s+(kavali|vastunda|vastundi|chahiye)\b/i,
  /\bnaaku\s+(cse|ece|eee|it|branch)\b/i,
  /\bmujhe\s+(cse|ece|eee|it|branch)\b/i,
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
function isMarksBasedRankPredictorQuery(text) {
  const t = normalizeText(text);
  if (!t || !/\d+(\.\d+)?/.test(t)) return false;
  if (hasRankSignal(t) && hasBranchSignal(t)) return false;
  if (hasRankSignal(t) && !MARKS_SIGNAL_PATTERN.test(t)) return false;
  if (MARKS_SIGNAL_PATTERN.test(t) && EXAM_SIGNAL_PATTERN.test(t)) return true;
  if (MARKS_SIGNAL_PATTERN.test(t) && /\b\d+(\.\d+)?\b/.test(t)) return true;
  if (EXAM_SIGNAL_PATTERN.test(t) && /\b\d+(\.\d+)?\b/.test(t) && !hasRankSignal(t)) {
    return true;
  }
  return false;
}

/**
 * Rank + branch admission queries — route to College Predictor
 * even when a Knowledge Assistant session is active.
 */
function isRankBranchCollegePredictorQuery(text) {
  const t = normalizeText(text);
  if (!t) return false;
  if (isMarksBasedRankPredictorQuery(t)) return false;
  if (MIXED_RANK_BRANCH_PATTERNS.some((pattern) => pattern.test(t))) {
    return true;
  }
  return hasRankSignal(t) && hasBranchSignal(t);
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

  if (matchesAny(t, GLOBAL_KEYWORDS.agent)) {
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

  if (botState && botState.state === 'college_predictor') {
    return { intent: 'college_predictor_continue', confidence: 'high' };
  }
  if (botState && botState.state === 'rank_predictor') {
    return { intent: 'rank_predictor_continue', confidence: 'high' };
  }

  if (isNativeSocialGreeting(original) || isSocialGreeting(t)) {
    return { intent: 'greeting', confidence: 'high' };
  }

  if (isMarksBasedRankPredictorQuery(t)) {
    return { intent: 'rank_predictor', confidence: 'high' };
  }

  if (isRankBranchCollegePredictorQuery(t)) {
    return { intent: 'college_predictor', confidence: 'high' };
  }

  if (isKnowledgeSessionActive(botState)) {
    return { intent: 'knowledge_assistant', confidence: 'medium' };
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
  if (/^3$|rank|predict rank|jee rank|eamcet rank/.test(t)) {
    return { intent: 'rank_predictor', confidence: 'high' };
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

  if (botState && botState.state === 'faq') {
    return { intent: 'faq_query', confidence: 'medium' };
  }

  return { intent: 'unknown', confidence: 'low' };
}

module.exports = {
  classifyIntent,
  normalizeText,
  isKnowledgeQuestion,
  isKnowledgeSessionActive,
  isNativeSocialGreeting,
  isSocialGreeting,
  isMarksBasedRankPredictorQuery,
  isRankBranchCollegePredictorQuery,
  isRankBranchRecommendationQuery,
  hasRankSignal,
  hasBranchSignal,
};
