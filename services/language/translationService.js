'use strict';

const { OpenAiCompatibleProvider } = require('../ai/providers/OpenAiCompatibleProvider');
const { aiDebugLog } = require('../chatbot/aiDebugLog');
const { normalizeLanguageCode, isSupportedLanguage } = require('../../constants/languageConstants');
const {
  getPreserveTerms,
  buildPreserveTermsPrompt,
} = require('../../constants/translationPreserveTerms');

const DEFAULT_TIMEOUT_MS = Number(process.env.TRANSLATION_TIMEOUT_MS) || 5000;

let defaultProvider = null;

function getProvider() {
  if (!defaultProvider) {
    defaultProvider = new OpenAiCompatibleProvider();
  }
  return defaultProvider;
}

function setTranslationProvider(provider) {
  defaultProvider = provider;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function restorePreserveTerms(text, originalText, terms = getPreserveTerms()) {
  let restored = String(text || '');
  const source = String(originalText || '');

  for (const term of terms) {
    if (!term) continue;
    const sourcePattern = new RegExp(escapeRegExp(term), 'gi');
    if (!sourcePattern.test(source)) continue;
    restored = restored.replace(new RegExp(escapeRegExp(term), 'gi'), term);
  }

  const numberMatches = source.match(/\d[\d,]*/g) || [];
  for (const numberToken of numberMatches) {
    if (restored.includes(numberToken)) continue;
    restored = restored.replace(/\bfifteen thousand\b/i, numberToken);
    restored = restored.replace(/\btwenty thousand\b/i, numberToken);
  }

  return restored.trim();
}

function buildToEnglishPrompt(sourceLanguage, preserveTerms) {
  return [
    'Translate the user message to English.',
    `Source language code: ${sourceLanguage}`,
    'Preserve these terms exactly as written (do not translate):',
    preserveTerms,
    'Preserve numbers, ranks, branch abbreviations, and product names.',
    'Return only the translated English text with no extra commentary.',
  ].join('\n');
}

function buildFromEnglishPrompt(targetLanguage, preserveTerms) {
  return [
    `Translate the English assistant reply to language code ${targetLanguage}.`,
    'Preserve these terms exactly as written (do not translate):',
    preserveTerms,
    'Preserve numbers, ranks, branch abbreviations, and product names.',
    'Use simple, clear language suitable for students and parents.',
    'Return only the translated text with no extra commentary.',
  ].join('\n');
}

async function translateWithProvider({
  text,
  systemPrompt,
  provider = getProvider(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const result = await provider.chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(text || '').trim() },
    ],
    temperature: 0.2,
    maxTokens: 1200,
    timeoutMs,
    maxRetries: 0,
  });
  return String(result?.text || '').trim();
}

async function translateToEnglish(text, sourceLanguage, options = {}) {
  const source = normalizeLanguageCode(sourceLanguage);
  const input = String(text || '').trim();
  if (!input) return input;
  if (source === 'en') return input;

  const preserveTerms = buildPreserveTermsPrompt(options.preserveTerms || getPreserveTerms());
  const startedAt = Date.now();
  try {
    const translated = await translateWithProvider({
      text: input,
      systemPrompt: buildToEnglishPrompt(source, preserveTerms),
      provider: options.provider,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });
    const restored = restorePreserveTerms(translated, input, options.preserveTerms || getPreserveTerms());
    aiDebugLog('LANG', 'translateToEnglish', { source, ms: Date.now() - startedAt });
    return restored;
  } catch (err) {
    aiDebugLog('LANG', 'translateToEnglish failed', { source, message: err.message });
    return input;
  }
}

async function translateFromEnglish(text, targetLanguage, options = {}) {
  const target = normalizeLanguageCode(targetLanguage);
  const input = String(text || '').trim();
  if (!input) return input;
  if (target === 'en') return input;
  if (!isSupportedLanguage(target)) return input;

  const preserveTerms = buildPreserveTermsPrompt(options.preserveTerms || getPreserveTerms());
  const startedAt = Date.now();
  try {
    const translated = await translateWithProvider({
      text: input,
      systemPrompt: buildFromEnglishPrompt(target, preserveTerms),
      provider: options.provider,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });
    const restored = restorePreserveTerms(translated, input, options.preserveTerms || getPreserveTerms());
    aiDebugLog('LANG', 'translateFromEnglish', { target, ms: Date.now() - startedAt });
    return restored;
  } catch (err) {
    aiDebugLog('LANG', 'translateFromEnglish failed', { target, message: err.message });
    return input;
  }
}

module.exports = {
  translateToEnglish,
  translateFromEnglish,
  restorePreserveTerms,
  setTranslationProvider,
  buildToEnglishPrompt,
  buildFromEnglishPrompt,
};
