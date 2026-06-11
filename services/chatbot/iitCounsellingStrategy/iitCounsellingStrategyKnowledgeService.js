'use strict';

const knowledgeBase = require('../../../knowledge/knowledgeBase.json');
const knowledgeSearchService = require('../knowledgeSearchService');
const { normalizeText } = require('../intentClassifierService');
const {
  ALLOWED_KB_CATEGORIES,
  SHORT_STRATEGY_QUERY_EXPANSIONS,
  TOPIC_FALLBACK_PATTERNS,
} = require('./iitCounsellingStrategyConstants');

function expandStrategyQuery(query) {
  const normalized = normalizeText(query);
  if (!normalized) return query;
  return SHORT_STRATEGY_QUERY_EXPANSIONS[normalized] || query;
}

function filterStrategyKbResults(results = []) {
  return results.filter((entry) =>
    ALLOWED_KB_CATEGORIES.has(String(entry.category || '').toLowerCase())
  );
}

function mergeKbResults(primary = [], secondary = [], limit = 5) {
  const seen = new Set();
  const merged = [];

  for (const entry of [...primary, ...secondary]) {
    const id = String(entry.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(entry);
  }

  return merged.slice(0, limit);
}

function normalizeQuestionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchKeywordStrategy(query, recallLimit = 20) {
  const keywordResults = knowledgeSearchService.searchKnowledgeKeyword(query, recallLimit);
  return filterStrategyKbResults(keywordResults);
}

function resolveTopicFallbackChunks(query) {
  const text = String(query || '').trim();
  if (!text) return [];

  for (const { pattern, questionPrefix } of TOPIC_FALLBACK_PATTERNS) {
    if (!pattern.test(text)) continue;

    const prefixKey = normalizeQuestionKey(questionPrefix);
    const matches = knowledgeBase
      .filter(
        (entry) =>
          ALLOWED_KB_CATEGORIES.has(String(entry.category || '').toLowerCase()) &&
          normalizeQuestionKey(entry.question).startsWith(prefixKey)
      )
      .map((entry) => ({
        id: entry.id,
        category: entry.category,
        question: entry.question,
        answer: entry.answer,
        score: 200,
        keywordScore: 200,
        vectorScore: null,
        retrievalSource: 'topic_fallback',
      }));

    if (matches.length) {
      return matches;
    }
  }

  return [];
}

function formatKbContext(kbResults = []) {
  if (!kbResults.length) return '';
  return kbResults.map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`).join('\n\n');
}

function resolveDirectKbAnswer(kbResults = [], userMessage = '') {
  const normalizedQuery = knowledgeSearchService
    .normalize(String(userMessage || '').replace(/\?+$/g, '').trim());
  if (!normalizedQuery) return null;

  for (const entry of kbResults) {
    const normalizedQuestion = knowledgeSearchService.normalize(
      String(entry.question || '').replace(/\?+$/g, '').trim()
    );
    if (normalizedQuestion === normalizedQuery) {
      const answer = String(entry.answer || '').trim();
      return answer || null;
    }
  }

  return null;
}

function resolveGroundedKbFallback(kbResults = [], userMessage = '') {
  const direct = resolveDirectKbAnswer(kbResults, userMessage);
  if (direct) return direct;

  const topicFallback = resolveTopicFallbackChunks(userMessage);
  if (topicFallback[0]?.answer) {
    return String(topicFallback[0].answer).trim() || null;
  }

  if (kbResults[0]?.answer) {
    return String(kbResults[0].answer).trim() || null;
  }

  return null;
}

async function searchIitCounsellingStrategyKnowledge(query, { retrievalQuery, limit = 5 } = {}) {
  const text = String(query || '').trim();
  const expandedQuery = expandStrategyQuery(text);
  const searchText = expandedQuery !== text ? expandedQuery : text;
  const recallLimit = Math.max(limit * 4, 20);
  const stages = [];

  const { results, metrics } = await knowledgeSearchService.searchKnowledgeAsync(searchText, {
    retrievalQuery: retrievalQuery || searchText,
    limit: Math.max(limit * 2, 8),
    recallLimit,
  });

  let kbResults = filterStrategyKbResults(results).slice(0, limit);
  stages.push({
    stage: 'hybrid_filtered',
    count: kbResults.length,
    resultIds: kbResults.map((entry) => entry.id),
    scores: kbResults.map((entry) => entry.score ?? entry.keywordScore ?? null),
  });

  const keywordHits = searchKeywordStrategy(searchText, recallLimit);
  kbResults = mergeKbResults(kbResults, keywordHits, limit);
  stages.push({
    stage: 'keyword_merge',
    count: keywordHits.length,
    resultIds: keywordHits.map((entry) => entry.id),
    scores: keywordHits.map((entry) => entry.score ?? entry.keywordScore ?? null),
  });

  if (!kbResults.length && searchText !== text) {
    const keywordExpanded = searchKeywordStrategy(expandedQuery, recallLimit);
    kbResults = mergeKbResults(kbResults, keywordExpanded, limit);
    stages.push({
      stage: 'keyword_expanded',
      count: keywordExpanded.length,
      resultIds: keywordExpanded.map((entry) => entry.id),
      scores: keywordExpanded.map((entry) => entry.score ?? entry.keywordScore ?? null),
    });
  }

  if (!kbResults.length) {
    const topicFallback = resolveTopicFallbackChunks(text);
    kbResults = topicFallback.slice(0, limit);
    stages.push({
      stage: 'topic_fallback',
      count: kbResults.length,
      resultIds: kbResults.map((entry) => entry.id),
      scores: kbResults.map((entry) => entry.score ?? null),
    });
    metrics.retrievalFallback = 'topic';
  }

  if (!kbResults.length && expandedQuery !== text) {
    const topicFallbackExpanded = resolveTopicFallbackChunks(expandedQuery);
    kbResults = topicFallbackExpanded.slice(0, limit);
    stages.push({
      stage: 'topic_fallback_expanded',
      count: kbResults.length,
      resultIds: kbResults.map((entry) => entry.id),
      scores: kbResults.map((entry) => entry.score ?? null),
    });
    if (kbResults.length) {
      metrics.retrievalFallback = 'topic_expanded';
    }
  }

  if (!kbResults.length) {
    // no-op: stages already recorded
  } else if (!filterStrategyKbResults(results).length && !metrics.retrievalFallback) {
    metrics.retrievalFallback = metrics.vectorCount === 0 ? 'keyword' : 'keyword_merge';
  }

  metrics.stages = stages;
  metrics.keywordStrategyCount = keywordHits.length;

  return {
    kbResults,
    metrics,
    knowledgeContext: formatKbContext(kbResults),
  };
}

function buildIitCounsellingStrategyContext({ knowledgeContext, leadContext } = {}) {
  const blocks = [];

  if (leadContext?.productLine) {
    blocks.push(`User product line: ${leadContext.productLine}`);
  }
  if (knowledgeContext) {
    blocks.push(`Knowledge Context:\n${knowledgeContext}`);
  } else {
    blocks.push('Knowledge Context: No matching IIT counselling strategy entries were found.');
  }

  return blocks.join('\n\n');
}

module.exports = {
  ALLOWED_KB_CATEGORIES,
  expandStrategyQuery,
  filterStrategyKbResults,
  mergeKbResults,
  searchKeywordStrategy,
  resolveTopicFallbackChunks,
  resolveDirectKbAnswer,
  resolveGroundedKbFallback,
  searchIitCounsellingStrategyKnowledge,
  buildIitCounsellingStrategyContext,
};
