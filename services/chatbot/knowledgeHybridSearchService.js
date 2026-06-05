'use strict';

const knowledgeSearchService = require('./knowledgeSearchService');
const knowledgeVectorSearchService = require('./knowledgeVectorSearchService');
const { rerankKnowledgeResults } = require('./knowledgeRerankService');
const { aiDebugLog } = require('./aiDebugLog');

const DEFAULT_RECALL_LIMIT = 20;

function resolveRecallLimit(options = {}) {
  return Number(
    options.recallLimit || process.env.KNOWLEDGE_KEYWORD_RECALL_LIMIT || DEFAULT_RECALL_LIMIT
  );
}

async function searchKnowledgeHybrid(query, options = {}) {
  const text = String(query || '').trim();
  const retrievalQuery = String(options.retrievalQuery || text).trim();
  const limit = Math.max(1, Number(options.limit) || 5);
  const recallLimit = Math.max(1, resolveRecallLimit(options));
  const startedAt = Date.now();

  let vectorResults = [];
  let vectorMetrics = {
    embedMs: 0,
    vectorSearchMs: 0,
    totalMs: 0,
    resultCount: 0,
  };
  let vectorError = null;

  const keywordStartedAt = Date.now();
  const keywordResults = knowledgeSearchService.searchKnowledgeKeyword(text, recallLimit);
  const keywordMs = Date.now() - keywordStartedAt;

  try {
    const vectorOut = await knowledgeVectorSearchService.searchKnowledgeVector(retrievalQuery, {
      recallLimit,
      embeddingOptions: options.embeddingOptions,
      indexName: options.indexName,
    });
    vectorResults = vectorOut.results;
    vectorMetrics = vectorOut.metrics;
  } catch (error) {
    vectorError = error;
    aiDebugLog('HYBRID', 'vector recall failed:', error.message);
  }

  const rerankStartedAt = Date.now();
  const results = vectorError
    ? keywordResults.slice(0, limit).map((entry) => ({
        ...entry,
        vectorScore: entry.vectorScore ?? null,
        keywordScore: entry.score,
      }))
    : rerankKnowledgeResults({
        vectorResults,
        keywordResults,
        query: text,
        limit,
      });
  const rerankMs = Date.now() - rerankStartedAt;
  const totalMs = Date.now() - startedAt;

  const metrics = {
    mode: 'hybrid',
    embedMs: vectorMetrics.embedMs,
    vectorSearchMs: vectorMetrics.vectorSearchMs,
    keywordMs,
    rerankMs,
    totalMs,
    vectorCount: vectorResults.length,
    keywordCount: keywordResults.length,
    resultIds: results.map((entry) => entry.id),
    fallback: vectorError ? 'keyword' : null,
    error: vectorError ? vectorError.message : null,
  };

  aiDebugLog('HYBRID', 'keywordMs =', keywordMs);
  aiDebugLog('HYBRID', 'rerankMs =', rerankMs);
  aiDebugLog('HYBRID', 'totalMs =', totalMs);
  aiDebugLog('HYBRID', 'ids =', metrics.resultIds);
  if (metrics.fallback) {
    aiDebugLog('HYBRID', 'fallback =', metrics.fallback);
  }

  return { results, metrics };
}

module.exports = {
  searchKnowledgeHybrid,
};
