'use strict';

const { validateAiResponse } = require('../aiGuardrailService');

const ICS_EMPTY_FALLBACK =
  'I could not prepare an IIT counselling strategy answer just now. Please reply AGENT to speak with our team, or MENU for more options.';

const UNKNOWN_FALLBACK =
  "I don't currently have verified guidance on that topic. Please contact the GuideXpert counselling team for personalized advice.";

const GENERIC_ASSISTANT_PATTERNS = [
  /\bi can help (you )?with coding\b/i,
  /\bbuilt to help\b.*\bcoding\b/i,
  /\bi am (built|designed|created) to help\b/i,
  /\bhelp you (learn|with) cod/i,
  /\bask me (any )?coding\b/i,
  /\byes,? i can help\b/i,
  /\bमैं कोडिंग सवालों में मदद\b/i,
  /\bనేను కోడింగ్‌లో మీకు సహాయం\b/i,
];

const STRATEGY_TOPIC_SIGNALS = [
  /\b(cse|ece|eee|mechanical|branch|college|iit|nit|jos+a+a?|float|freeze|slide|placement)\b/i,
  /\b(counselling|counseling|strategy|preference|trade-?off)\b/i,
];

const RANK_PREDICTION_PATTERNS = [
  /\byou will (definitely |surely )?get\b/i,
  /\bguaranteed (admission|seat)\b/i,
  /\bdefinitely get (cse|ece|eee|it)\b/i,
  /\byou can easily get\b/i,
  /\bclosing rank (is|was|will be)\s+\d+/i,
  /\bopening rank (is|was|will be)\s+\d+/i,
  /\bcutoff (is|was|will be)\s+\d+/i,
  /\bwith rank \d+ you will\b/i,
  /\b\d+\s*%\s*(chance|probability)\b/i,
  /\bseat probability\b/i,
];

function containsRankPrediction(text) {
  const value = String(text || '');
  return RANK_PREDICTION_PATTERNS.some((pattern) => pattern.test(value));
}

function hasGrounding(knowledgeResults = []) {
  return knowledgeResults.some((entry) => String(entry?.answer || '').trim().length > 0);
}

function isGenericAssistantResponse(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return GENERIC_ASSISTANT_PATTERNS.some((pattern) => pattern.test(value));
}

function isStrategyRelatedResponse(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return STRATEGY_TOPIC_SIGNALS.some((pattern) => pattern.test(value));
}

function validateIitCounsellingStrategyResponse({
  response,
  knowledgeResults = [],
  userMessage = '',
  englishUserMessage = '',
  leadContext = null,
  resolvedLanguage = 'en',
} = {}) {
  const text = String(response || '').trim();

  if (!text) {
    return { text: ICS_EMPTY_FALLBACK, modified: true, reason: 'empty_response' };
  }

  if (containsRankPrediction(text)) {
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'rank_prediction_blocked' };
  }

  if (isGenericAssistantResponse(text) || (!isStrategyRelatedResponse(text) && /\bcoding\b/i.test(text))) {
    return { text: '', modified: true, reason: 'generic_assistant_rejected' };
  }

  if (!hasGrounding(knowledgeResults)) {
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'no_grounding' };
  }

  const validated = validateAiResponse({
    response: text,
    knowledgeResults,
    userMessage,
    englishUserMessage,
    leadContext,
    resolvedLanguage,
  });

  if (containsRankPrediction(validated.text)) {
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'rank_prediction_blocked' };
  }

  return validated;
}

module.exports = {
  validateIitCounsellingStrategyResponse,
  isGenericAssistantResponse,
  isStrategyRelatedResponse,
  UNKNOWN_FALLBACK,
  ICS_EMPTY_FALLBACK,
};
