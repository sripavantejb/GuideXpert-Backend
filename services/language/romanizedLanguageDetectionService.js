'use strict';

const ROMANIZED_CONFIDENCE = 0.88;

const HINDI_PHRASES = [
  'kaise ho aap',
  'aap kaise ho',
  'kya kar rahe ho',
  'khana khaya',
  'kaise ho',
];

const TELUGU_PHRASES = [
  'em chesthunnav',
  'nenu bagunnanu',
  'ela vunnaru',
  'ela unnaru',
  'bagunnava',
  'bagunnara',
  'thinnava',
  'tinnava',
  'cheppu',
  'avuna',
  'ledhu',
  'enti',
];

const HINDI_MIXED_PHRASES = [
  'mujhe cse chahiye',
  'rank ki cse',
  'meri rank',
  'cse chahiye',
];

const TELUGU_MIXED_PHRASES = [
  'naaku cse kavali',
  'rank tho cse',
  'rank lo cse',
  'cse kavali',
];

const HINDI_COUNSELLING_TOKENS = ['mujhe', 'chahiye', 'meri', 'hai', 'milega', 'milta'];

const TELUGU_STRONG_TOKENS = [
  'chesthunnav',
  'thinnava',
  'tinnava',
  'bagunnanu',
  'bagunnava',
  'bagunnara',
  'vunnaru',
  'unnaru',
  'ledhu',
  'avuna',
  'cheppu',
  'enti',
];

const TELUGU_COUNSELLING_TOKENS = ['naaku', 'naku', 'kavali', 'vastunda', 'vastundi', 'tho', 'cheyandi'];

const HINDI_WHOLE_MESSAGE_TOKENS = new Set(['mujhe', 'chahiye']);

function normalizeRomanizedText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesExactPhrase(normalized, phrase) {
  return normalized === phrase;
}

function matchesMultiWordPhrase(normalized, phrase) {
  if (!phrase.includes(' ')) return false;
  return normalized === phrase || normalized.includes(phrase);
}

function matchesWordBoundary(normalized, token) {
  const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
  return pattern.test(normalized);
}

function matchesAnyWordBoundary(normalized, tokens) {
  return tokens.some((token) => matchesWordBoundary(normalized, token));
}

function detectRomanizedLanguage(message) {
  const normalized = normalizeRomanizedText(message);
  if (!normalized || !/^[\x00-\x7F]+$/.test(normalized)) {
    return null;
  }

  for (const phrase of HINDI_PHRASES) {
    if (matchesExactPhrase(normalized, phrase) || matchesMultiWordPhrase(normalized, phrase)) {
      return { language: 'hi', confidence: ROMANIZED_CONFIDENCE, matched: phrase };
    }
  }

  for (const phrase of TELUGU_MIXED_PHRASES) {
    if (matchesExactPhrase(normalized, phrase) || matchesMultiWordPhrase(normalized, phrase)) {
      return { language: 'te', confidence: ROMANIZED_CONFIDENCE, matched: phrase };
    }
  }

  if (matchesAnyWordBoundary(normalized, TELUGU_COUNSELLING_TOKENS)) {
    const matched =
      TELUGU_COUNSELLING_TOKENS.find((token) => matchesWordBoundary(normalized, token)) || 'telugu_counselling';
    return { language: 'te', confidence: ROMANIZED_CONFIDENCE, matched };
  }

  for (const phrase of HINDI_MIXED_PHRASES) {
    if (matchesExactPhrase(normalized, phrase) || matchesMultiWordPhrase(normalized, phrase)) {
      return { language: 'hi', confidence: ROMANIZED_CONFIDENCE, matched: phrase };
    }
  }

  if (HINDI_WHOLE_MESSAGE_TOKENS.has(normalized)) {
    return { language: 'hi', confidence: ROMANIZED_CONFIDENCE, matched: normalized };
  }

  if (matchesAnyWordBoundary(normalized, HINDI_COUNSELLING_TOKENS)) {
    const matched =
      HINDI_COUNSELLING_TOKENS.find((token) => matchesWordBoundary(normalized, token)) || 'hindi_counselling';
    return { language: 'hi', confidence: ROMANIZED_CONFIDENCE, matched };
  }

  for (const phrase of TELUGU_PHRASES) {
    if (matchesExactPhrase(normalized, phrase) || matchesMultiWordPhrase(normalized, phrase)) {
      return { language: 'te', confidence: ROMANIZED_CONFIDENCE, matched: phrase };
    }
  }

  for (const token of TELUGU_STRONG_TOKENS) {
    if (matchesWordBoundary(normalized, token)) {
      return { language: 'te', confidence: ROMANIZED_CONFIDENCE, matched: token };
    }
  }

  return null;
}

module.exports = {
  detectRomanizedLanguage,
  normalizeRomanizedText,
  ROMANIZED_CONFIDENCE,
};
