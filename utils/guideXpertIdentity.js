'use strict';

const { getGuideXpertIdentityFaqAnswer } = require('../config/chatbotFaq');

const UNSUPPORTED_REPLY_PATTERNS = [
  /do not have verified information/i,
  /don't currently have verified information/i,
  /I am not sure I understood/i,
  /reply AGENT to speak with our team/i,
];

function isUnsupportedFallbackText(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  return UNSUPPORTED_REPLY_PATTERNS.some((pattern) => pattern.test(value));
}

function hasGuideXpertIdentityContext(knowledgeResults = [], faqHits = []) {
  if (
    faqHits.some(
      (entry) => entry?.slug === 'what-is-guidexpert' || /what is guidexpert/i.test(String(entry?.title || ''))
    )
  ) {
    return true;
  }
  return knowledgeResults.some(
    (entry) =>
      String(entry?.category || '').toLowerCase() === 'guidexpert' ||
      String(entry?.category || '').toLowerCase() === 'faq'
  );
}

function pickGuideXpertKbAnswer(knowledgeResults = []) {
  const identityEntry = knowledgeResults.find((entry) =>
    /what is guidexpert/i.test(String(entry?.question || ''))
  );
  if (identityEntry?.answer) return String(identityEntry.answer).trim();

  const guidexpertEntry = knowledgeResults.find(
    (entry) => String(entry?.category || '').toLowerCase() === 'guidexpert' && entry?.answer
  );
  return guidexpertEntry ? String(guidexpertEntry.answer).trim() : null;
}

function resolveGuideXpertIdentityFallback(knowledgeResults = [], faqHits = []) {
  const faqAnswer = getGuideXpertIdentityFaqAnswer();
  if (faqAnswer) return faqAnswer;

  const kbAnswer = pickGuideXpertKbAnswer(knowledgeResults);
  if (kbAnswer) return kbAnswer;

  return null;
}

function coerceGuideXpertIdentityAnswer({
  response,
  knowledgeResults = [],
  faqHits = [],
  isIdentityQuestion = false,
} = {}) {
  if (!isIdentityQuestion) return null;
  if (!hasGuideXpertIdentityContext(knowledgeResults, faqHits)) return null;

  const text = String(response || '').trim();
  if (text && !isUnsupportedFallbackText(text)) {
    return text;
  }

  return resolveGuideXpertIdentityFallback(knowledgeResults, faqHits);
}

module.exports = {
  isUnsupportedFallbackText,
  hasGuideXpertIdentityContext,
  resolveGuideXpertIdentityFallback,
  coerceGuideXpertIdentityAnswer,
};
