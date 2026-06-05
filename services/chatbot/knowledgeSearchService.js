'use strict';

const knowledgeBase = require('../../knowledge/knowledgeBase.json');
const { aiDebugLog } = require('./aiDebugLog');

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'about',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'tell',
  'the',
  'they',
  'this',
  'to',
  'we',
  'what',
  'why',
  'with',
  'you',
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function tokenizeAll(value) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 2);
}

function countMatches(tokens, text) {
  const words = text.split(' ');
  return tokens.reduce((count, token) => {
    if (words.includes(token) || text.includes(token)) return count + 1;
    return count;
  }, 0);
}

function buildBigrams(tokens) {
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

function scoreEntry(entry, query, queryTokens) {
  const category = normalize(entry.category);
  const question = normalize(entry.question);
  const answer = normalize(entry.answer);
  const combined = `${category} ${question} ${answer}`;
  const allQueryTokens = tokenizeAll(query);
  const meaningfulMatches = countMatches(queryTokens, combined);
  const questionTokenMatches = countMatches(allQueryTokens, question);
  const answerTokenMatches = countMatches(queryTokens, answer);
  let score = 0;

  if (!query) return 0;
  if (queryTokens.length > 0 && meaningfulMatches === 0) return 0;

  if (question === query) score += 120;
  if (question.includes(query)) score += 70;
  if (answer.includes(query)) score += 30;
  if (category.includes(query)) score += 35;
  if (allQueryTokens.length > 0 && questionTokenMatches === allQueryTokens.length) score += 45;
  score += questionTokenMatches * 6;
  score += answerTokenMatches;

  for (const phrase of buildBigrams(allQueryTokens)) {
    if (question.includes(phrase)) score += 14;
    if (answer.includes(phrase)) score += 4;
  }

  for (const token of queryTokens) {
    if (question.split(' ').includes(token)) score += 12;
    else if (question.includes(token)) score += 7;

    if (category.split(' ').includes(token)) score += 8;
    else if (category.includes(token)) score += 4;

    if (answer.split(' ').includes(token)) score += 3;
    else if (answer.includes(token)) score += 1;

    if (combined.includes(token)) score += 1;
  }

  return score;
}

function normalizeEntry(entry) {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
  };
}

function rankKnowledgeEntries(query, limit, maxCap) {
  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(normalizedQuery);
  const max = Math.max(1, Math.min(Number(limit) || 5, maxCap));

  if (!normalizedQuery || queryTokens.length === 0) {
    return [];
  }

  return knowledgeBase
    .map((entry) => ({
      ...normalizeEntry(entry),
      score: scoreEntry(entry, normalizedQuery, queryTokens),
      keywordScore: scoreEntry(entry, normalizedQuery, queryTokens),
      vectorScore: null,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
    .slice(0, max);
}

function searchKnowledge(query, limit = 5) {
  return rankKnowledgeEntries(query, limit, 10);
}

function searchKnowledgeKeyword(query, limit = 20) {
  return rankKnowledgeEntries(query, limit, 20);
}

function scoreKnowledgeEntry(entry, query) {
  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(normalizedQuery);
  return scoreEntry(
    {
      id: entry.id,
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
    },
    normalizedQuery,
    queryTokens
  );
}

function resolveSearchMode() {
  const mode = String(process.env.KNOWLEDGE_SEARCH_MODE || 'hybrid').trim().toLowerCase();
  if (mode === 'keyword' || mode === 'vector' || mode === 'hybrid') {
    return mode;
  }
  return 'hybrid';
}

async function searchKnowledgeAsync(query, options = {}) {
  const text = String(query || '').trim();
  const retrievalQuery = String(options.retrievalQuery || text).trim();
  const limit = Math.max(1, Number(options.limit) || 5);
  const recallLimit = Math.max(
    1,
    Number(options.recallLimit || process.env.KNOWLEDGE_KEYWORD_RECALL_LIMIT || 20)
  );
  const mode = resolveSearchMode();
  const startedAt = Date.now();

  aiDebugLog('KB', 'Mode:', mode);
  aiDebugLog('KB', 'Retrieval Query:', retrievalQuery);

  try {
    if (mode === 'keyword') {
      const keywordStartedAt = Date.now();
      const results = searchKnowledge(text, limit);
      return {
        results,
        metrics: {
          mode,
          keywordMs: Date.now() - keywordStartedAt,
          totalMs: Date.now() - startedAt,
          resultIds: results.map((entry) => entry.id),
        },
      };
    }

    if (mode === 'vector') {
      const { searchKnowledgeVector } = require('./knowledgeVectorSearchService');
      const vectorOut = await searchKnowledgeVector(retrievalQuery, {
        recallLimit,
        embeddingOptions: options.embeddingOptions,
        indexName: options.indexName,
      });
      const results = vectorOut.results.slice(0, limit);
      return {
        results,
        metrics: {
          mode,
          ...vectorOut.metrics,
          totalMs: Date.now() - startedAt,
          resultIds: results.map((entry) => entry.id),
        },
      };
    }

    const { searchKnowledgeHybrid } = require('./knowledgeHybridSearchService');
    return await searchKnowledgeHybrid(text, {
      retrievalQuery,
      limit,
      recallLimit,
      embeddingOptions: options.embeddingOptions,
      indexName: options.indexName,
    });
  } catch (error) {
    aiDebugLog('HYBRID', 'fallback to keyword:', error.message);
    const keywordStartedAt = Date.now();
    const results = searchKnowledge(text, limit);
    return {
      results,
      metrics: {
        mode,
        fallback: 'keyword',
        error: error.message,
        keywordMs: Date.now() - keywordStartedAt,
        totalMs: Date.now() - startedAt,
        resultIds: results.map((entry) => entry.id),
      },
    };
  }
}

module.exports = {
  searchKnowledge,
  searchKnowledgeKeyword,
  scoreKnowledgeEntry,
  searchKnowledgeAsync,
  resolveSearchMode,
  normalize,
  tokenize,
};
