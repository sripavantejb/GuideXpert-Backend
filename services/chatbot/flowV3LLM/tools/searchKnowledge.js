'use strict';

const defaultKnowledgeSearchService = require('../../knowledgeSearchService');

/**
 * M-1 knowledge search — preserves chunk IDs from searchKnowledgeAsync.
 * @param {{ query?: string, limit?: number, retrievalQuery?: string, recallLimit?: number }} args
 * @param {{ deps?: { searchKnowledgeAsync?: Function } }} [_ctx]
 */
async function run(args = {}, _ctx = {}) {
  const searchFn =
    (_ctx.deps && _ctx.deps.searchKnowledgeAsync) ||
    defaultKnowledgeSearchService.searchKnowledgeAsync;

  const query = String(args.query || '').trim();
  if (!query) {
    return { ok: false, error: 'empty_query', results: [], metrics: null };
  }

  const out = await searchFn(query, {
    limit: args.limit,
    retrievalQuery: args.retrievalQuery,
    recallLimit: args.recallLimit,
  });

  const results = (out.results || []).map((entry) => ({
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    score: entry.score ?? null,
    keywordScore: entry.keywordScore ?? null,
    vectorScore: entry.vectorScore ?? null,
  }));

  return {
    ok: true,
    results,
    metrics: out.metrics || null,
    resultIds: results.map((r) => r.id),
  };
}

module.exports = { run };
