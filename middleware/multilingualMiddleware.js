'use strict';

const { detectLanguage } = require('../services/language/languageDetectionService');
const {
  translateToEnglish,
  translateFromEnglish,
  DEFAULT_OUTBOUND_TIMEOUT_MS,
  DEFAULT_OUTBOUND_MAX_TOKENS,
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

function previewText(text, max = 200) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function finalizeMultilingualOutbound({
  englishResponse,
  language,
  originalMessage,
  guardrailModified = false,
  outboundTrace = null,
} = {}) {
  const text = String(englishResponse || '').trim();
  const trace = {
    outboundTranslationExecuted: false,
    translateFromEnglishExecuted: false,
    outboundTranslationLanguage: String(language || 'en').toLowerCase(),
    outboundTranslationPassThrough: false,
    usedLocalizedFallback: false,
    translatedResponsePreview: null,
  };

  if (!text) {
    if (outboundTrace) Object.assign(outboundTrace, trace);
    return text;
  }

  const targetLanguage = trace.outboundTranslationLanguage;
  if (!isMultilingualEnabled() || targetLanguage === 'en') {
    trace.outboundTranslationPassThrough = true;
    if (outboundTrace) Object.assign(outboundTrace, trace);
    return text;
  }

  trace.outboundTranslationExecuted = true;

  const localizedFallback = localizeKnownFallback(text, targetLanguage);
  if (localizedFallback !== text) {
    trace.usedLocalizedFallback = true;
    trace.translatedResponsePreview = previewText(localizedFallback);
    aiDebugLog('LANG', 'finalizeMultilingualOutbound localized fallback');
    if (outboundTrace) Object.assign(outboundTrace, trace);
    return localizedFallback;
  }

  const startedAt = Date.now();
  const translation = await translateFromEnglish(text, targetLanguage, {
    timeoutMs: DEFAULT_OUTBOUND_TIMEOUT_MS,
    maxTokens: DEFAULT_OUTBOUND_MAX_TOKENS,
  });
  const translated = translation.text || text;
  trace.translateFromEnglishExecuted = Boolean(translation.translateFromEnglishExecuted);
  trace.outboundTranslationPassThrough = Boolean(translation.passThrough);
  trace.translatedResponsePreview = previewText(translated);

  aiDebugLog('LANG', 'finalizeMultilingualOutbound', {
    targetLanguage,
    guardrailModified,
    ms: Date.now() - startedAt,
    translateFromEnglishExecuted: trace.translateFromEnglishExecuted,
    outboundTranslationPassThrough: trace.outboundTranslationPassThrough,
    originalMessage: previewText(originalMessage, 120),
  });

  if (outboundTrace) Object.assign(outboundTrace, trace);
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
