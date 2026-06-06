'use strict';

const { classifyDevanagariLanguage, containsDevanagari } = require('../services/language/devanagariLanguageClassifier');
const { normalizeLanguageCode } = require('../constants/languageConstants');

const SCRIPT_PATTERNS = {
  te: /[\u0C00-\u0C7F]/,
  hi: /[\u0900-\u097F]/,
  bn: /[\u0980-\u09FF]/,
  kn: /[\u0C80-\u0CFF]/,
  ml: /[\u0D00-\u0D7F]/,
  ta: /[\u0B80-\u0BFF]/,
  mr: /[\u0900-\u097F]/,
};

function countLatinLetters(text) {
  const matches = String(text || '').match(/[A-Za-z]/g);
  return matches ? matches.length : 0;
}

function countScriptMatches(text, pattern) {
  const matches = String(text || '').match(new RegExp(pattern.source, 'g'));
  return matches ? matches.length : 0;
}

function detectDominantScriptLanguage(text) {
  const value = String(text || '').trim();
  if (!value) return null;

  const latinCount = countLatinLetters(value);
  const devanagariCount = countScriptMatches(value, SCRIPT_PATTERNS.hi);

  const scores = Object.entries(SCRIPT_PATTERNS)
    .filter(([lang]) => lang !== 'mr')
    .map(([lang, pattern]) => ({
      lang,
      score: lang === 'hi' ? devanagariCount : countScriptMatches(value, pattern),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (devanagariCount > 0) {
    const devanagari = classifyDevanagariLanguage(value);
    if (devanagari?.language) {
      return devanagari.language;
    }
  }

  if (scores.length === 0) {
    return latinCount >= 4 ? 'en' : null;
  }

  const top = scores[0];
  if (latinCount > top.score * 1.5 && latinCount >= 20) {
    return 'en';
  }

  if (top.lang === 'hi' && devanagariCount > 0) {
    return null;
  }

  return top.lang;
}

/**
 * Verify outbound reply matches expected resolved language.
 * @returns {{ pass: boolean, detected: string|null, reason: string|null }}
 */
function assertReplyLanguage(text, expectedLanguage) {
  const expected = normalizeLanguageCode(expectedLanguage) || 'en';
  const value = String(text || '').trim();

  if (!value) {
    return { pass: false, detected: null, reason: 'empty_reply' };
  }

  if (expected === 'en') {
    const detected = detectDominantScriptLanguage(value);
    if (detected === 'en' || detected === null) {
      return { pass: true, detected: 'en', reason: null };
    }
    if (countLatinLetters(value) >= countScriptMatches(value, SCRIPT_PATTERNS[detected] || /$^/)) {
      return { pass: true, detected: 'en', reason: 'latin_dominant' };
    }
    return { pass: false, detected, reason: 'expected_english' };
  }

  const detected = detectDominantScriptLanguage(value);
  if (!detected) {
    return { pass: false, detected: null, reason: 'no_script_match' };
  }

  if (detected === expected) {
    return { pass: true, detected, reason: null };
  }

  if ((expected === 'hi' || expected === 'mr') && (detected === 'hi' || detected === 'mr')) {
    const devanagari = classifyDevanagariLanguage(value);
    if (devanagari?.language === expected) {
      return { pass: true, detected: devanagari.language, reason: 'devanagari_lexical' };
    }
  }

  return { pass: false, detected, reason: `expected_${expected}_got_${detected}` };
}

module.exports = {
  assertReplyLanguage,
  detectDominantScriptLanguage,
  containsDevanagari,
};
