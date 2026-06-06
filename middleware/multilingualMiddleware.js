'use strict';

const { detectLanguage } = require('../services/language/languageDetectionService');
const {
  translateToEnglish,
  translateFromEnglish,
} = require('../services/language/translationService');
const { localizeKnownFallback } = require('../constants/localizedFallbackStrings');
const { aiDebugLog } = require('../services/chatbot/aiDebugLog');
const { isMultilingualEnabled } = require('../utils/multilingualFlags');
const {
  resolveConversationLanguage,
  recordDetectedLanguage,
} = require('../services/chatbot/conversationLanguageService');

async function prepareMultilingualInbound({ message, conversation, leadContext } = {}) {
  const originalMessage = String(message || '').trim();
  const passthrough = {
    originalMessage,
    englishMessage: originalMessage,
    language: 'en',
    detectedLanguage: 'en',
    confidence: 1,
    translationApplied: false,
    resolvedLanguage: 'en',
  };

  if (!isMultilingualEnabled() || !originalMessage) {
    return passthrough;
  }

  const startedAt = Date.now();
  const detection = await detectLanguage({ message: originalMessage });
  const resolved = resolveConversationLanguage(conversation, leadContext, detection);

  let englishMessage = originalMessage;
  let translationApplied = false;

  if (resolved.language !== 'en') {
    try {
      englishMessage = await translateToEnglish(originalMessage, resolved.language);
      translationApplied = englishMessage !== originalMessage;
    } catch (err) {
      aiDebugLog('LANG', 'prepareMultilingualInbound translate failed', err.message);
      englishMessage = originalMessage;
      translationApplied = false;
    }
  }

  if (conversation?._id) {
    try {
      await recordDetectedLanguage(conversation._id, detection.language, detection.confidence);
    } catch (err) {
      aiDebugLog('LANG', 'recordDetectedLanguage failed', err.message);
    }
  }

  aiDebugLog('LANG', 'prepareMultilingualInbound', {
    detectedLanguage: detection.language,
    resolvedLanguage: resolved.language,
    translationApplied,
    ms: Date.now() - startedAt,
  });

  return {
    originalMessage,
    englishMessage,
    language: resolved.language,
    detectedLanguage: detection.language,
    confidence: detection.confidence,
    translationApplied,
    resolvedLanguage: resolved.language,
    detectionSource: detection.source,
  };
}

async function finalizeMultilingualOutbound({
  englishResponse,
  language,
  originalMessage,
  guardrailModified = false,
} = {}) {
  const text = String(englishResponse || '').trim();
  if (!text) return text;

  const targetLanguage = String(language || 'en').toLowerCase();
  if (!isMultilingualEnabled() || targetLanguage === 'en') {
    return text;
  }

  const localizedFallback = localizeKnownFallback(text, targetLanguage);
  if (localizedFallback !== text) {
    aiDebugLog('LANG', 'finalizeMultilingualOutbound localized fallback');
    return localizedFallback;
  }

  const startedAt = Date.now();
  const translated = await translateFromEnglish(text, targetLanguage);
  aiDebugLog('LANG', 'finalizeMultilingualOutbound', {
    targetLanguage,
    guardrailModified,
    ms: Date.now() - startedAt,
  });
  return translated || text;
}

function multilingualExpressMiddleware() {
  return async function multilingualExpressMiddlewareHandler(req, _res, next) {
    try {
      const message = String(req.body?.message || req.body?.text || '').trim();
      const inbound = await prepareMultilingualInbound({
        message,
        conversation: req.conversation || null,
        leadContext: req.leadContext || null,
      });
      req.language = inbound.language;
      req.originalMessage = inbound.originalMessage;
      req.englishMessage = inbound.englishMessage;
      req.multilingualInbound = inbound;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  isMultilingualEnabled,
  prepareMultilingualInbound,
  finalizeMultilingualOutbound,
  multilingualExpressMiddleware,
};
