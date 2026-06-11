'use strict';

const knowledgeSearchService = require('../knowledgeSearchService');
const { normalizeText } = require('../intentClassifierService');
const { ALLOWED_KB_CATEGORIES, SHORT_IIT_QUERY_EXPANSIONS } = require('./iitCounsellingConstants');

function expandIitQuery(query) {
  const normalized = normalizeText(query);
  if (!normalized) return query;
  return SHORT_IIT_QUERY_EXPANSIONS[normalized] || query;
}

function filterIitCounsellingKbResults(results = []) {
  return results.filter((entry) =>
    ALLOWED_KB_CATEGORIES.has(String(entry.category || '').toLowerCase())
  );
}

function formatKbContext(kbResults = []) {
  if (!kbResults.length) return '';
  return kbResults.map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`).join('\n\n');
}

async function searchIitCounsellingKnowledge(query, { retrievalQuery, limit = 5 } = {}) {
  const text = String(query || '').trim();
  const expandedQuery = expandIitQuery(text);
  const searchText = expandedQuery !== text ? expandedQuery : text;
  const { results, metrics } = await knowledgeSearchService.searchKnowledgeAsync(searchText, {
    retrievalQuery: retrievalQuery || searchText,
    limit: Math.max(limit * 2, 8),
  });
  let kbResults = filterIitCounsellingKbResults(results).slice(0, limit);

  if (!kbResults.length && searchText !== expandedQuery) {
    const fallback = await knowledgeSearchService.searchKnowledgeAsync(expandedQuery, {
      retrievalQuery: expandedQuery,
      limit: Math.max(limit * 2, 8),
    });
    kbResults = filterIitCounsellingKbResults(fallback.results).slice(0, limit);
  }

  return {
    kbResults,
    metrics,
    knowledgeContext: formatKbContext(kbResults),
  };
}

function buildIitCounsellingContext({ knowledgeContext, leadContext } = {}) {
  const blocks = [];

  if (leadContext?.productLine) {
    blocks.push(`User product line: ${leadContext.productLine}`);
  }
  if (knowledgeContext) {
    blocks.push(`Knowledge Context:\n${knowledgeContext}`);
  } else {
    blocks.push('Knowledge Context: No matching IIT counselling entries were found.');
  }

  return blocks.join('\n\n');
}

module.exports = {
  ALLOWED_KB_CATEGORIES,
  expandIitQuery,
  filterIitCounsellingKbResults,
  searchIitCounsellingKnowledge,
  buildIitCounsellingContext,
};
