'use strict';

const { normalizeForScope } = require('./scopeNormalizationService');

/** Tokens protected by fuzzy / typo matching when regex misses. */
const FUZZY_PROTECTED_TOKENS = Object.freeze([
  'python',
  'java',
  'javascript',
  'leetcode',
  'bitcoin',
  'weather',
  'movie',
  'algorithm',
  'binary',
  'graph',
]);

/** Multi-word phrases checked via collapsed spacing. */
const FUZZY_PROTECTED_PHRASES = Object.freeze([
  'binary tree',
  'bit coin',
  'leet code',
]);

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function maxDistanceForToken(token) {
  if (token.length <= 5) return 2;
  if (token.length <= 8) return 2;
  return 2;
}

function tokenMatchesFuzzy(word, protectedToken) {
  if (!word || !protectedToken) return false;
  if (word === protectedToken) return true;
  if (word.length < 3 || protectedToken.length < 3) return false;
  const dist = levenshtein(word, protectedToken);
  return dist <= maxDistanceForToken(protectedToken);
}

const PHRASE_CATEGORY = Object.freeze({
  'bit coin': 'finance',
  'binary tree': 'programming',
  'leet code': 'programming',
});

/**
 * Map fuzzy token hits to scope deny categories.
 */
const TOKEN_CATEGORY = Object.freeze({
  python: 'programming',
  java: 'programming',
  javascript: 'programming',
  leetcode: 'programming',
  algorithm: 'programming',
  binary: 'programming',
  graph: 'programming',
  bitcoin: 'finance',
  weather: 'weather',
  movie: 'movies',
});

/**
 * @param {string} text normalized scope text
 * @returns {{ category: string, token: string, match: string }|null}
 */
function findFuzzyDenyMatch(text) {
  const normalized = normalizeForScope(text);
  if (!normalized) return null;

  for (const phrase of FUZZY_PROTECTED_PHRASES) {
    const collapsed = normalized.replace(/\s+/g, ' ');
    if (collapsed.includes(phrase.replace(/\s+/g, ' '))) {
      return {
        category: PHRASE_CATEGORY[phrase] || TOKEN_CATEGORY[phrase.split(' ')[0]] || 'programming',
        token: phrase,
        match: 'phrase',
      };
    }
    const parts = phrase.split(' ');
    if (parts.length === 2) {
      const combined = parts[0] + parts[1];
      for (const word of normalized.split(/\s+/)) {
        if (tokenMatchesFuzzy(word, combined)) {
          return {
            category: TOKEN_CATEGORY[parts[0]] || 'programming',
            token: phrase,
            match: word,
          };
        }
      }
    }
  }

  for (const word of normalized.split(/\s+/)) {
    for (const token of FUZZY_PROTECTED_TOKENS) {
      if (tokenMatchesFuzzy(word, token)) {
        return {
          category: TOKEN_CATEGORY[token] || 'programming',
          token,
          match: word,
        };
      }
    }
  }

  return null;
}

module.exports = {
  FUZZY_PROTECTED_TOKENS,
  FUZZY_PROTECTED_PHRASES,
  levenshtein,
  findFuzzyDenyMatch,
};
