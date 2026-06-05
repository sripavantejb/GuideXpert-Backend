'use strict';

const { scoreKnowledgeEntry } = require('./knowledgeSearchService');

const DEFAULT_RRF_K = 60;
const DEFAULT_KEYWORD_WEIGHT = 0.45;

function resolveKeywordWeight() {
  const parsed = Number(process.env.KNOWLEDGE_HYBRID_KEYWORD_WEIGHT);
  if (!Number.isFinite(parsed)) return DEFAULT_KEYWORD_WEIGHT;
  return Math.max(0, Math.min(parsed, 1));
}

function normalizeScores(values) {
  if (!values.length) return [];
  const max = Math.max(...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => value / max);
}

function mergeCandidates(vectorResults = [], keywordResults = []) {
  const merged = new Map();

  for (const result of [...vectorResults, ...keywordResults]) {
    if (!result || result.id == null) continue;
    const existing = merged.get(result.id);
    if (existing) {
      merged.set(result.id, {
        ...existing,
        ...result,
        vectorScore: result.vectorScore ?? existing.vectorScore ?? null,
        keywordScore: result.keywordScore ?? existing.keywordScore ?? null,
      });
    } else {
      merged.set(result.id, { ...result });
    }
  }

  return [...merged.values()];
}

function computeRrfScores(lists, k = DEFAULT_RRF_K) {
  const scores = new Map();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank += 1) {
      const item = list[rank];
      if (!item || item.id == null) continue;
      const increment = 1 / (k + rank + 1);
      scores.set(item.id, (scores.get(item.id) || 0) + increment);
    }
  }

  return scores;
}

function rerankKnowledgeResults({
  vectorResults = [],
  keywordResults = [],
  query,
  limit = 5,
} = {}) {
  const merged = mergeCandidates(vectorResults, keywordResults);
  if (merged.length === 0) {
    return [];
  }

  const rrfScores = computeRrfScores([vectorResults, keywordResults]);
  const keywordScores = merged.map((entry) => scoreKnowledgeEntry(entry, query));
  const normalizedRrf = normalizeScores(merged.map((entry) => rrfScores.get(entry.id) || 0));
  const normalizedKeyword = normalizeScores(keywordScores);
  const keywordWeight = resolveKeywordWeight();
  const rrfWeight = 1 - keywordWeight;

  const ranked = merged
    .map((entry, index) => {
      const fusedScore = rrfWeight * normalizedRrf[index] + keywordWeight * normalizedKeyword[index];
      return {
        id: entry.id,
        category: entry.category,
        question: entry.question,
        answer: entry.answer,
        score: fusedScore,
        vectorScore: entry.vectorScore ?? null,
        keywordScore: keywordScores[index] || entry.keywordScore || 0,
        rrfScore: rrfScores.get(entry.id) || 0,
      };
    })
    .sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id))
    .slice(0, Math.max(1, limit));

  return ranked;
}

module.exports = {
  rerankKnowledgeResults,
  mergeCandidates,
  computeRrfScores,
  DEFAULT_RRF_K,
};
