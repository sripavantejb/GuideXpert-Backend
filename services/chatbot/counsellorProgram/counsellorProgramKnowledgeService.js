'use strict';

const { CHATBOT_FAQ } = require('../../../config/chatbotFaq');
const knowledgeSearchService = require('../knowledgeSearchService');
const faqService = require('../faqService');
const { normalizeText } = require('../intentClassifierService');

const ALLOWED_KB_CATEGORIES = new Set(['guidexpert']);

const PROGRAM_FAQ_SLUGS = new Set([
  'what-is-guidexpert',
  'book-demo',
  'iit-counselling',
  'meeting-link',
  'program-fees',
  'program-benefits',
  'program-mentorship',
  'program-duration',
]);

const SHORT_PROGRAM_QUERY_EXPANSIONS = {
  fee: 'GuideXpert counselling program fees pricing cost',
  fees: 'GuideXpert counselling program fees pricing cost',
  price: 'GuideXpert counselling program fees pricing cost',
  pricing: 'GuideXpert counselling program fees pricing cost',
  cost: 'GuideXpert counselling program fees pricing cost',
  benefit: 'GuideXpert counselling program benefits',
  benefits: 'GuideXpert counselling program benefits',
  mentorship: 'GuideXpert mentorship counselling guidance',
  duration: 'GuideXpert counselling program duration how long',
  sessions: 'GuideXpert counselling sessions demo',
  session: 'GuideXpert counselling sessions demo',
  'fees kya hai': 'GuideXpert counselling program fees pricing cost',
  'price kya hai': 'GuideXpert counselling program fees pricing cost',
  'benefits kya hai': 'GuideXpert counselling program benefits',
  'fees enti': 'GuideXpert counselling program fees pricing cost',
  'benefits enti': 'GuideXpert counselling program benefits',
  'what is guidexpert': 'GuideXpert what exactly do we do platform career counselling',
  'tell me about guidexpert': 'GuideXpert what exactly do we do platform career counselling',
  'i want to know about guidexpert': 'GuideXpert what exactly do we do platform career counselling',
  'about guidexpert': 'GuideXpert what exactly do we do platform career counselling',
  'who are you': 'GuideXpert what exactly do we do platform career counselling',
};

function expandProgramQuery(query) {
  const normalized = normalizeText(query);
  if (!normalized) return query;
  return SHORT_PROGRAM_QUERY_EXPANSIONS[normalized] || query;
}

function filterGuidexpertKbResults(results = []) {
  return results.filter((entry) => ALLOWED_KB_CATEGORIES.has(String(entry.category || '').toLowerCase()));
}

function searchProgramFaqs(query) {
  const staticHits = faqService.searchStaticFaq(query);
  return staticHits.filter((entry) => PROGRAM_FAQ_SLUGS.has(entry.slug));
}

function formatFaqContext(faqHits = []) {
  if (!faqHits.length) return '';
  return faqHits
    .map((entry) => `FAQ: ${entry.title}\n${entry.answer}`)
    .join('\n\n');
}

function formatKbContext(kbResults = []) {
  if (!kbResults.length) return '';
  return kbResults
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
    .join('\n\n');
}

async function searchCounsellorProgramKnowledge(query, { retrievalQuery, limit = 5 } = {}) {
  const text = String(query || '').trim();
  const expandedQuery = expandProgramQuery(text);
  const faqHits = searchProgramFaqs(text);
  const searchText = expandedQuery !== text ? expandedQuery : text;
  const { results, metrics } = await knowledgeSearchService.searchKnowledgeAsync(searchText, {
    retrievalQuery: retrievalQuery || searchText,
    limit: Math.max(limit * 2, 8),
  });
  let kbResults = filterGuidexpertKbResults(results).slice(0, limit);

  if (!kbResults.length && searchText !== expandedQuery) {
    const fallback = await knowledgeSearchService.searchKnowledgeAsync(expandedQuery, {
      retrievalQuery: expandedQuery,
      limit: Math.max(limit * 2, 8),
    });
    kbResults = filterGuidexpertKbResults(fallback.results).slice(0, limit);
  }

  return {
    faqHits,
    kbResults,
    metrics,
    faqContext: formatFaqContext(faqHits),
    knowledgeContext: formatKbContext(kbResults),
  };
}

function buildCounsellorProgramContext({ faqContext, knowledgeContext, leadContext } = {}) {
  const blocks = [];

  if (leadContext?.productLine) {
    blocks.push(`User product line: ${leadContext.productLine}`);
  }
  if (faqContext) {
    blocks.push(`FAQ Context:\n${faqContext}`);
  }
  if (knowledgeContext) {
    blocks.push(`Knowledge Context:\n${knowledgeContext}`);
  }
  if (!faqContext && !knowledgeContext) {
    blocks.push('Knowledge Context: No matching GuideXpert program entries were found.');
  }

  return blocks.join('\n\n');
}

function isProgramRelatedFaq(query) {
  const t = normalizeText(query);
  if (!t) return false;
  return CHATBOT_FAQ.some((entry) => {
    if (!PROGRAM_FAQ_SLUGS.has(entry.slug)) return false;
    if (normalizeText(entry.title).includes(t)) return true;
    return (entry.keywords || []).some((kw) => t.includes(normalizeText(kw)));
  });
}

module.exports = {
  ALLOWED_KB_CATEGORIES,
  SHORT_PROGRAM_QUERY_EXPANSIONS,
  expandProgramQuery,
  searchCounsellorProgramKnowledge,
  buildCounsellorProgramContext,
  filterGuidexpertKbResults,
  isProgramRelatedFaq,
};
