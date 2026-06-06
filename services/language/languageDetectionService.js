'use strict';

const { franc } = require('franc');
const { OpenAiCompatibleProvider } = require('../ai/providers/OpenAiCompatibleProvider');
const { aiDebugLog } = require('../chatbot/aiDebugLog');
const { detectRomanizedLanguage } = require('./romanizedLanguageDetectionService');
const {
  FRANC_TO_ISO,
  normalizeLanguageCode,
  isSupportedLanguage,
} = require('../../constants/languageConstants');

const DEFAULT_MIN_CONFIDENCE = Number(process.env.LANGUAGE_DETECT_MIN_CONFIDENCE) || 0.75;
const LLM_FALLBACK_ENABLED = String(process.env.LANGUAGE_DETECT_LLM_FALLBACK || '1').trim() !== '0';

const INDIC_SCRIPT_PATTERN =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/;

let defaultProvider = null;

function getProvider() {
  if (!defaultProvider) {
    defaultProvider = new OpenAiCompatibleProvider();
  }
  return defaultProvider;
}

function setLanguageDetectionProvider(provider) {
  defaultProvider = provider;
}

function mapFrancCode(francCode) {
  if (!francCode || francCode === 'und') return null;
  return FRANC_TO_ISO[francCode] || null;
}

function estimateOfflineConfidence(message, language) {
  const text = String(message || '').trim();
  if (!text) return 0;
  if (!language || !isSupportedLanguage(language)) return 0.2;

  const hasIndicScript = INDIC_SCRIPT_PATTERN.test(text);
  const isAsciiOnly = /^[\x00-\x7F]+$/.test(text);

  if (language === 'en' && isAsciiOnly && text.length >= 4) return 0.92;
  if (language !== 'en' && hasIndicScript && text.length >= 6) return 0.88;
  if (text.length >= 12) return 0.8;
  if (text.length >= 8) return 0.76;
  return 0.45;
}

function tryRomanizedDetection(text, startedAt) {
  const isAsciiOnly = /^[\x00-\x7F]+$/.test(text);
  if (!isAsciiOnly) return null;

  const romanized = detectRomanizedLanguage(text);
  if (!romanized) return null;

  aiDebugLog('LANG', 'romanized detect', {
    ...romanized,
    ms: Date.now() - startedAt,
  });
  return {
    language: romanized.language,
    confidence: romanized.confidence,
    source: 'romanized',
  };
}

async function detectLanguageWithLlm(message, provider = getProvider()) {
  const text = String(message || '').trim();
  if (!text) {
    return { language: 'en', confidence: 0.5, source: 'fallback' };
  }

  const prompt = [
    'Detect the language of the user message.',
    'Return strict JSON only: {"language":"en|te|hi|ta|kn|ml|mr|bn","confidence":0.0-1.0}',
    'Use ISO 639-1 codes listed above.',
    `Message: ${text}`,
  ].join('\n');

  const result = await provider.chatCompletion({
    messages: [
      { role: 'system', content: 'You are a language detector. Output JSON only.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    maxTokens: 80,
    timeoutMs: Number(process.env.TRANSLATION_TIMEOUT_MS) || 5000,
    maxRetries: 0,
  });

  const raw = String(result?.text || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { language: 'en', confidence: 0.5, source: 'fallback' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const language = normalizeLanguageCode(parsed.language);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7));
    return { language, confidence, source: 'llm_fallback' };
  } catch (_e) {
    return { language: 'en', confidence: 0.5, source: 'fallback' };
  }
}

async function detectLanguage({ message, provider } = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return { language: 'en', confidence: 1, source: 'fallback' };
  }

  const startedAt = Date.now();
  const francCode = franc(text, { minLength: 3 });
  let offlineLanguage = mapFrancCode(francCode);
  let offlineConfidence = estimateOfflineConfidence(text, offlineLanguage);
  const minConfidence = DEFAULT_MIN_CONFIDENCE;
  const isAsciiOnly = /^[\x00-\x7F]+$/.test(text);

  if (
    isAsciiOnly &&
    text.length >= 4 &&
    (!offlineLanguage || offlineConfidence < minConfidence) &&
    !detectRomanizedLanguage(text)
  ) {
    offlineLanguage = 'en';
    offlineConfidence = estimateOfflineConfidence(text, offlineLanguage);
  }

  aiDebugLog('LANG', 'offline detect', {
    francCode,
    offlineLanguage,
    offlineConfidence,
    ms: Date.now() - startedAt,
  });

  if (offlineLanguage && offlineConfidence >= minConfidence) {
    if (offlineLanguage === 'en') {
      const romanizedResult = tryRomanizedDetection(text, startedAt);
      if (romanizedResult) return romanizedResult;
    }
    return {
      language: offlineLanguage,
      confidence: offlineConfidence,
      source: 'offline',
    };
  }

  const romanizedBeforeLlm = tryRomanizedDetection(text, startedAt);
  if (romanizedBeforeLlm) return romanizedBeforeLlm;

  if (LLM_FALLBACK_ENABLED && String(process.env.LLM_API_KEY || '').trim()) {
    try {
      const llmResult = await detectLanguageWithLlm(text, provider || getProvider());
      aiDebugLog('LANG', 'llm detect', { ...llmResult, ms: Date.now() - startedAt });
      if (isSupportedLanguage(llmResult.language)) {
        return llmResult;
      }
    } catch (e) {
      aiDebugLog('LANG', 'llm detect failed', e.message);
    }
  }

  if (offlineLanguage && isSupportedLanguage(offlineLanguage)) {
    return {
      language: offlineLanguage,
      confidence: offlineConfidence,
      source: 'offline',
    };
  }

  return { language: 'en', confidence: 0.5, source: 'fallback' };
}

module.exports = {
  detectLanguage,
  detectLanguageWithLlm,
  normalizeLanguageCode,
  isSupportedLanguage,
  setLanguageDetectionProvider,
  estimateOfflineConfidence,
  mapFrancCode,
};
