'use strict';

const { detectLanguage } = require('../services/language/languageDetectionService');
const {
  translateToEnglish,
  translateFromEnglish,
  DEFAULT_OUTBOUND_TIMEOUT_MS,
  DEFAULT_OUTBOUND_MAX_TOKENS,
} = require('../services/language/translationService');
const { localizeKnownFallback } = require('../constants/localizedFallbackStrings');
const { resolveSystemReply } = require('../constants/localizedSystemReplies');
const { aiDebugLog } = require('../services/chatbot/aiDebugLog');
const { isMultilingualEnabled } = require('../utils/multilingualFlags');
const { formatForWhatsApp } = require('../utils/whatsappMessageFormatter');
const { assertReplyLanguage } = require('../utils/replyLanguageVerifier');
const {
  resolveConversationLanguage,
  recordDetectedLanguage,
  updatePreferredLanguage,
} = require('../services/chatbot/conversationLanguageService');
const { normalizeLanguageCode } = require('../constants/languageConstants');

function normalizePreferredLanguage(value) {
  const code = normalizeLanguageCode(value);
  return code || 'en';
}

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
    resolutionReason: 'fallback',
    preferredLanguage: normalizePreferredLanguage(conversation?.preferredLanguage),
  };

  if (!isMultilingualEnabled() || !originalMessage) {
    return passthrough;
  }

  const startedAt = Date.now();
  const preferredLanguageSnapshot = normalizePreferredLanguage(conversation?.preferredLanguage);
  const detection = await detectLanguage({ message: originalMessage });
  const resolved = resolveConversationLanguage(
    conversation,
    leadContext,
    detection,
    originalMessage
  );

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
      if (resolved.resolutionReason === 'explicit_english_greeting') {
        await updatePreferredLanguage(conversation._id, 'en');
      } else if (resolved.resolutionReason === 'explicit_telugu_greeting') {
        await updatePreferredLanguage(conversation._id, 'te');
      } else {
        await recordDetectedLanguage(conversation._id, detection.language, detection.confidence);
      }
    } catch (err) {
      aiDebugLog('LANG', 'recordDetectedLanguage failed', err.message);
    }
  }

  aiDebugLog('LANG', 'prepareMultilingualInbound', {
    detectedLanguage: detection.language,
    confidence: detection.confidence,
    preferredLanguage: preferredLanguageSnapshot,
    resolvedLanguage: resolved.language,
    resolutionReason: resolved.resolutionReason,
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
    resolutionReason: resolved.resolutionReason,
    resolutionSource: resolved.source,
    preferredLanguage: preferredLanguageSnapshot,
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

/**
 * Unified outbound gate — all user-facing replies pass through here.
 * @returns {Promise<{ text: string, verification: object, outboundTrace: object }>}
 */
async function applyMultilingualOutbound({
  replyText,
  resolvedLanguage = 'en',
  originalMessage = '',
  outboundTrace = null,
  localizationTier = 'translate',
  preLocalized = false,
  guardrailModified = false,
} = {}) {
  const trace = outboundTrace || {
    outboundTranslationExecuted: false,
    translateFromEnglishExecuted: false,
    outboundTranslationLanguage: normalizeLanguageCode(resolvedLanguage) || 'en',
    outboundTranslationPassThrough: false,
    usedLocalizedFallback: false,
    shouldTranslateOutbound: localizationTier === 'translate',
    translatedResponsePreview: null,
    verifiedResponseLanguage: null,
    languageMismatch: false,
  };

  const lang = normalizeLanguageCode(resolvedLanguage) || 'en';
  let text = String(replyText || '').trim();
  if (!text) {
    if (outboundTrace) Object.assign(outboundTrace, trace);
    return { text: '', verification: { pass: false, detected: null, reason: 'empty_reply' }, outboundTrace: trace };
  }

  if (preLocalized || localizationTier === 'static') {
    text = formatForWhatsApp(text);
    trace.outboundTranslationPassThrough = true;
    trace.shouldTranslateOutbound = false;
    const verification = assertReplyLanguage(text, lang);
    trace.verifiedResponseLanguage = verification.detected;
    trace.languageMismatch = !verification.pass;
    if (outboundTrace) Object.assign(outboundTrace, trace);
    return { text, verification, outboundTrace: trace };
  }

  text = formatForWhatsApp(text);
  if (!isMultilingualEnabled() || lang === 'en') {
    trace.outboundTranslationPassThrough = true;
    trace.shouldTranslateOutbound = false;
    const verification = assertReplyLanguage(text, lang);
    trace.verifiedResponseLanguage = verification.detected;
    trace.languageMismatch = !verification.pass;
    if (outboundTrace) Object.assign(outboundTrace, trace);
    return { text, verification, outboundTrace: trace };
  }

  trace.shouldTranslateOutbound = true;
  try {
    text = await module.exports.finalizeMultilingualOutbound({
      englishResponse: text,
      language: lang,
      originalMessage,
      guardrailModified,
      outboundTrace: trace,
    });
  } catch (err) {
    aiDebugLog('LANG', 'applyMultilingualOutbound failed', err.message);
    const localized = localizeKnownFallback(text, lang);
    if (localized !== text) {
      text = localized;
      trace.usedLocalizedFallback = true;
    }
  }

  text = formatForWhatsApp(text);
  let verification = assertReplyLanguage(text, lang);

  if (
    !verification.pass &&
    lang !== 'en' &&
    trace.outboundTranslationExecuted &&
    trace.outboundTranslationPassThrough
  ) {
    try {
      const retry = await translateFromEnglish(String(replyText || '').trim(), lang, {
        timeoutMs: DEFAULT_OUTBOUND_TIMEOUT_MS,
        maxTokens: DEFAULT_OUTBOUND_MAX_TOKENS,
      });
      if (retry.text && !retry.passThrough) {
        text = formatForWhatsApp(retry.text);
        trace.outboundTranslationPassThrough = false;
        trace.translateFromEnglishExecuted = true;
        trace.translatedResponsePreview = previewText(text);
        verification = assertReplyLanguage(text, lang);
      }
    } catch (err) {
      aiDebugLog('LANG', 'applyMultilingualOutbound retry failed', err.message);
    }
  }

  if (!verification.pass && lang !== 'en') {
    const localized = resolveSystemReply('orchestratorFallback', lang);
    if (localized) {
      text = formatForWhatsApp(localized);
      trace.usedLocalizedFallback = true;
      trace.outboundTranslationPassThrough = true;
      verification = assertReplyLanguage(text, lang);
    }
  }

  trace.verifiedResponseLanguage = verification.detected;
  trace.languageMismatch = !verification.pass;
  if (outboundTrace) Object.assign(outboundTrace, trace);
  return { text, verification, outboundTrace: trace };
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
  applyMultilingualOutbound,
  multilingualExpressMiddleware,
};
