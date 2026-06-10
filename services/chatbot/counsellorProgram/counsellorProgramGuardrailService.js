'use strict';

const { validateAiResponse } = require('../aiGuardrailService');

const UNKNOWN_FALLBACK =
  'I do not have verified information about that program yet. Please reply AGENT to speak with our team, or MENU for more options.';

const BLOCKED_TERM_PATTERNS = [
  /\bosvi\b/i,
  /\binternal (system|project|tool|codename)\b/i,
  /\b(hidden|secret) (system|project|api)\b/i,
];

const COMPETITOR_PATTERNS = [
  /\b(?:vs\.?|versus|compared to|better than)\s+[A-Za-z][A-Za-z0-9]+\b/i,
  /\b(?:competitor|rival)\b/i,
];

function containsBlockedTerms(text) {
  const value = String(text || '');
  return (
    BLOCKED_TERM_PATTERNS.some((pattern) => pattern.test(value)) ||
    COMPETITOR_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function validateCounsellorProgramResponse({
  response,
  knowledgeResults = [],
  userMessage = '',
  englishUserMessage = '',
} = {}) {
  const text = String(response || '').trim();
  if (!text) {
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'empty_response' };
  }

  if (containsBlockedTerms(text)) {
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'blocked_term' };
  }

  return validateAiResponse({
    response: text,
    knowledgeResults,
    userMessage,
    englishUserMessage,
  });
}

module.exports = {
  validateCounsellorProgramResponse,
  UNKNOWN_FALLBACK,
};
