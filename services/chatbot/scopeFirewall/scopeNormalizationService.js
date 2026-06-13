'use strict';

/** Emoji → canonical token replacements (applied before regex/fuzzy). */
const EMOJI_TOKEN_MAP = Object.freeze({
  '🐍': ' python ',
  '🌦': ' weather ',
  '⚽': ' sports score ',
  '💰': ' bitcoin ',
  '🎬': ' movie ',
});

/**
 * Visually confusable non-Latin characters → ASCII (homoglyph folding).
 * Applied after NFKC so composed forms are stable.
 */
const HOMOGLYPH_MAP = Object.freeze({
  '\u0430': 'a', // Cyrillic а
  '\u0435': 'e', // Cyrillic е
  '\u043e': 'o', // Cyrillic о
  '\u0440': 'p', // Cyrillic р
  '\u0441': 'c', // Cyrillic с
  '\u0443': 'y', // Cyrillic у
  '\u0445': 'x', // Cyrillic х
  '\u0456': 'i', // Cyrillic і
  '\u04cf': 'l', // Cyrillic palochka → l
  '\u03bf': 'o', // Greek omicron
  '\u03b1': 'a', // Greek alpha
  '\u03b5': 'e', // Greek epsilon
  '\u03c1': 'p', // Greek rho
  '\u03c5': 'u', // Greek upsilon
  '\u03c7': 'x', // Greek chi
  '\u03bd': 'v', // Greek nu → v (bitcoin typo patterns)
  '\u0458': 'j', // Cyrillic ј
  '\u04bb': 'h', // Cyrillic shha
});

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u00AD]/g;

function foldHomoglyphs(text) {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] || ch;
  }
  return out;
}

function expandEmojiTokens(text) {
  let out = String(text || '');
  for (const [emoji, token] of Object.entries(EMOJI_TOKEN_MAP)) {
    out = out.split(emoji).join(token);
  }
  return out;
}

/**
 * Full normalization pipeline for scope evaluation.
 * @param {string} text
 * @returns {string}
 */
function normalizeForScope(text) {
  let value = expandEmojiTokens(String(text || ''));
  value = value.normalize('NFKC');
  value = value.replace(ZERO_WIDTH_RE, '');
  value = foldHomoglyphs(value);
  value = value.trim().toLowerCase();
  value = value.replace(/\s+/g, ' ');
  return value;
}

module.exports = {
  EMOJI_TOKEN_MAP,
  normalizeForScope,
  expandEmojiTokens,
  foldHomoglyphs,
};
