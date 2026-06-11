#!/usr/bin/env node
'use strict';

require('dotenv').config();

const {
  searchIitCounsellingKnowledge,
  searchKeywordIitCounselling,
} = require('../services/chatbot/iitCounsellingExpert/iitCounsellingKnowledgeService');
const knowledgeSearchService = require('../services/chatbot/knowledgeSearchService');

const QUESTIONS = [
  'What is OBC-NCL rank?',
  'What is CRL rank?',
  'What is home state quota?',
  'What is float?',
  'What is slide?',
  'What is CSAB?',
];

async function traceQuestion(question) {
  const hybrid = await knowledgeSearchService.searchKnowledgeAsync(question, {
    retrievalQuery: question,
    limit: 8,
    recallLimit: 20,
  });
  const keywordHits = searchKeywordIitCounselling(question, 20);
  const retrieval = await searchIitCounsellingKnowledge(question, { limit: 5 });

  console.log(`\n=== ${question} ===`);
  console.log('Hybrid mode:', hybrid.metrics?.mode, 'fallback:', hybrid.metrics?.fallback || 'none');
  console.log('Vector hits:', hybrid.metrics?.vectorCount ?? 0);
  console.log('Keyword hits (all KB):', hybrid.metrics?.keywordCount ?? keywordHits.length);
  console.log(
    'Hybrid top (unfiltered):',
    hybrid.results.slice(0, 5).map((entry) => ({
      id: entry.id,
      category: entry.category,
      score: entry.score ?? entry.keywordScore,
      vectorScore: entry.vectorScore ?? null,
      question: entry.question,
    }))
  );
  console.log(
    'Keyword IIT hits:',
    keywordHits.slice(0, 5).map((entry) => ({
      id: entry.id,
      score: entry.score,
      question: entry.question,
    }))
  );
  console.log('Retrieval stages:', JSON.stringify(retrieval.metrics?.stages || [], null, 2));
  console.log(
    'Chunks returned:',
    retrieval.kbResults.map((entry) => ({
      id: entry.id,
      category: entry.category,
      score: entry.score ?? entry.keywordScore ?? null,
      question: entry.question,
      answerPreview: String(entry.answer || '').slice(0, 120),
    }))
  );
}

async function main() {
  for (const question of QUESTIONS) {
    await traceQuestion(question);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
