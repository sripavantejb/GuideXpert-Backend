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
]);

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
  const faqHits = searchProgramFaqs(text);
  const { results, metrics } = await knowledgeSearchService.searchKnowledgeAsync(text, {
    retrievalQuery: retrievalQuery || text,
    limit: Math.max(limit * 2, 8),
  });
  const kbResults = filterGuidexpertKbResults(results).slice(0, limit);

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
  searchCounsellorProgramKnowledge,
  buildCounsellorProgramContext,
  filterGuidexpertKbResults,
  isProgramRelatedFaq,
};
