'use strict';

const { validateAiResponse } = require('../aiGuardrailService');
const { isGuideXpertIdentityQuestion } = require('../intentClassifierService');
const {
  coerceGuideXpertIdentityAnswer,
  isUnsupportedFallbackText,
} = require('../../../utils/guideXpertIdentity');

const CPA_EMPTY_FALLBACK =
  'I could not prepare a program answer just now. Please reply AGENT to speak with our team, or MENU for more options.';

const UNKNOWN_FALLBACK =
  "I don't currently have verified information about that topic. Please contact the GuideXpert counselling team for accurate guidance.";

const OSVI_BLOCKED_FALLBACK =
  "I can't share internal system details here. I can help with GuideXpert counselling programs, fees, and how to join—what would you like to know?";

const COMPETITOR_BLOCKED_FALLBACK =
  "I focus on explaining GuideXpert's counselling programs rather than comparing other providers. Tell me what you're looking for and I'll suggest the right GuideXpert option.";

const BLOCKED_TERM_PATTERNS = [
  /\bosvi\b/i,
  /\binternal (system|project|tool|codename)\b/i,
  /\b(hidden|secret) (system|project|api)\b/i,
];

const COMPETITOR_PATTERNS = [
  /\b(?:vs\.?|versus|compared to|better than)\s+[A-Za-z][A-Za-z0-9]+\b/i,
  /\b(?:competitor|rival)\b/i,
];

function containsOsviTerms(text) {
  const value = String(text || '');
  return BLOCKED_TERM_PATTERNS.some((pattern) => pattern.test(value));
}

function containsCompetitorTerms(text) {
  const value = String(text || '');
  return COMPETITOR_PATTERNS.some((pattern) => pattern.test(value));
}

function validateCounsellorProgramResponse({
  response,
  knowledgeResults = [],
  faqHits = [],
  userMessage = '',
  englishUserMessage = '',
  leadContext = null,
  resolvedLanguage = 'en',
} = {}) {
  const text = String(response || '').trim();
  const identityQuestion = isGuideXpertIdentityQuestion(userMessage, englishUserMessage);

  if (!text) {
    const identityAnswer = coerceGuideXpertIdentityAnswer({
      response: text,
      knowledgeResults,
      faqHits,
      isIdentityQuestion: identityQuestion,
    });
    if (identityAnswer) {
      return { text: identityAnswer, modified: true, reason: 'guidexpert_identity_grounded' };
    }
    return { text: CPA_EMPTY_FALLBACK, modified: true, reason: 'empty_response' };
  }

  if (containsOsviTerms(text)) {
    return { text: OSVI_BLOCKED_FALLBACK, modified: true, reason: 'blocked_osvi_term' };
  }

  if (containsCompetitorTerms(text)) {
    return { text: COMPETITOR_BLOCKED_FALLBACK, modified: true, reason: 'blocked_competitor_term' };
  }

  if (identityQuestion && isUnsupportedFallbackText(text)) {
    const identityAnswer = coerceGuideXpertIdentityAnswer({
      response: text,
      knowledgeResults,
      faqHits,
      isIdentityQuestion: true,
    });
    if (identityAnswer) {
      return { text: identityAnswer, modified: true, reason: 'guidexpert_identity_grounded' };
    }
  }

  const validated = validateAiResponse({
    response: text,
    knowledgeResults,
    userMessage,
    englishUserMessage,
    leadContext,
    resolvedLanguage,
  });

  if (identityQuestion && isUnsupportedFallbackText(validated.text)) {
    const identityAnswer = coerceGuideXpertIdentityAnswer({
      response: validated.text,
      knowledgeResults,
      faqHits,
      isIdentityQuestion: true,
    });
    if (identityAnswer) {
      return { text: identityAnswer, modified: true, reason: 'guidexpert_identity_grounded' };
    }
  }

  return validated;
}

module.exports = {
  validateCounsellorProgramResponse,
  UNKNOWN_FALLBACK,
  CPA_EMPTY_FALLBACK,
  OSVI_BLOCKED_FALLBACK,
  COMPETITOR_BLOCKED_FALLBACK,
};
