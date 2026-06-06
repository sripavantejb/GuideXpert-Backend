'use strict';

const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

const HINDI_MARKERS = [
  { token: 'आप', weight: 2 },
  { token: 'मुझे', weight: 2 },
  { token: 'चाहिए', weight: 2 },
  { token: 'हैं', weight: 1 },
  { token: 'कैसे', weight: 1 },
  { token: 'हूँ', weight: 1 },
  { token: 'हूं', weight: 1 },
  { token: 'है', weight: 1 },
  { token: 'मेरा', weight: 1 },
  { token: 'मेरी', weight: 1 },
  { token: 'मिलेगा', weight: 1 },
];

const MARATHI_MARKERS = [
  { token: 'तुम्ही', weight: 2 },
  { token: 'मला', weight: 2 },
  { token: 'पाहिजे', weight: 2 },
  { token: 'आहात', weight: 2 },
  { token: 'म्हणून', weight: 2 },
  { token: 'म्हणजे', weight: 2 },
  { token: 'आमच्या', weight: 2 },
  { token: 'काय', weight: 1 },
  { token: 'आहे', weight: 1 },
  { token: 'कसे', weight: 1 },
  { token: 'तुमचा', weight: 1 },
  { token: 'तुमची', weight: 1 },
  { token: 'मिळेल', weight: 1 },
  { token: 'झाली', weight: 1 },
  { token: 'गरज', weight: 1 },
  { token: 'नाही', weight: 1 },
];

function containsDevanagari(text) {
  return DEVANAGARI_PATTERN.test(String(text || ''));
}

function scoreMarkers(text, markers) {
  const value = String(text || '');
  let score = 0;
  const matched = [];

  for (const { token, weight } of markers) {
    if (value.includes(token)) {
      score += weight;
      matched.push(token);
    }
  }

  return { score, matched };
}

/**
 * Distinguish Hindi vs Marathi on Devanagari script using lexical markers.
 * @returns {{ language: 'hi'|'mr'|null, confidence: number, matchedTokens: string[], source: 'devanagari_lexical' }|null}
 */
function classifyDevanagariLanguage(text) {
  const value = String(text || '').trim();
  if (!containsDevanagari(value)) {
    return null;
  }

  const hindi = scoreMarkers(value, HINDI_MARKERS);
  const marathi = scoreMarkers(value, MARATHI_MARKERS);

  if (hindi.score === 0 && marathi.score === 0) {
    return null;
  }

  const delta = Math.abs(hindi.score - marathi.score);
  if (delta === 0 && hindi.score > 0) {
    return {
      language: null,
      confidence: 0.5,
      matchedTokens: [...hindi.matched, ...marathi.matched],
      source: 'devanagari_lexical',
    };
  }

  const marathiWins = marathi.score > hindi.score;
  const winningScore = marathiWins ? marathi.score : hindi.score;
  const confidence = Math.min(0.99, 0.75 + delta * 0.05 + winningScore * 0.02);

  return {
    language: marathiWins ? 'mr' : 'hi',
    confidence,
    matchedTokens: marathiWins ? marathi.matched : hindi.matched,
    source: 'devanagari_lexical',
  };
}

module.exports = {
  classifyDevanagariLanguage,
  containsDevanagari,
  HINDI_MARKERS,
  MARATHI_MARKERS,
};
