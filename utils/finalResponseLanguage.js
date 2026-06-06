'use strict';

const SCRIPT_RANGES = [
  { lang: 'te', pattern: /[\u0C00-\u0C7F]/g },
  { lang: 'hi', pattern: /[\u0900-\u097F]/g },
  { lang: 'bn', pattern: /[\u0980-\u09FF]/g },
  { lang: 'kn', pattern: /[\u0C80-\u0CFF]/g },
  { lang: 'ml', pattern: /[\u0D00-\u0D7F]/g },
  { lang: 'ta', pattern: /[\u0B80-\u0BFF]/g },
  { lang: 'mr', pattern: /[\u0900-\u097F]/g },
];

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Infer the dominant language script in an outbound WhatsApp message.
 */
function inferFinalResponseLanguage(text) {
  const value = String(text || '').trim();
  if (!value) return 'unknown';

  const latinCount = countMatches(value, /[A-Za-z]/g);
  const scores = SCRIPT_RANGES.map(({ lang, pattern }) => ({
    lang,
    score: countMatches(value, pattern),
  })).sort((a, b) => b.score - a.score);

  const top = scores[0];
  if (!top || top.score === 0) {
    return latinCount > 0 ? 'en' : 'unknown';
  }

  if (latinCount > top.score * 1.5 && latinCount >= 20) {
    return 'en';
  }

  return top.lang;
}

module.exports = {
  inferFinalResponseLanguage,
};
