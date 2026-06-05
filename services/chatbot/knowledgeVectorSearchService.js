'use strict';

const mongoose = require('mongoose');
const KnowledgeChunk = require('../../models/KnowledgeChunk');
const embeddingService = require('../ai/embeddingService');
const { aiDebugLog } = require('./aiDebugLog');

const DEFAULT_INDEX_NAME = 'knowledge_vector_index';
const DEFAULT_NUM_CANDIDATES = 50;
const DEFAULT_RECALL_LIMIT = 20;

function resolveVectorSearchConfig(options = {}) {
  return {
    indexName:
      String(options.indexName || process.env.KNOWLEDGE_VECTOR_INDEX_NAME || DEFAULT_INDEX_NAME).trim(),
    numCandidates: Number(
      options.numCandidates || process.env.KNOWLEDGE_VECTOR_NUM_CANDIDATES || DEFAULT_NUM_CANDIDATES
    ),
    recallLimit: Number(
      options.recallLimit || process.env.KNOWLEDGE_VECTOR_RECALL_LIMIT || DEFAULT_RECALL_LIMIT
    ),
  };
}

function assertMongoConnected() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB is not connected for vector search');
  }
}

function mapVectorResult(row) {
  const vectorScore = Number(row.vectorScore);
  return {
    id: row.sourceId,
    category: row.category,
    question: row.question,
    answer: row.answer,
    score: vectorScore,
    vectorScore,
    keywordScore: null,
  };
}

async function searchKnowledgeVector(query, options = {}) {
  const text = String(query || '').trim();
  if (!text) {
    return {
      results: [],
      metrics: { embedMs: 0, vectorSearchMs: 0, totalMs: 0, resultCount: 0 },
    };
  }

  assertMongoConnected();
  const config = resolveVectorSearchConfig(options);
  const startedAt = Date.now();

  const embedStartedAt = Date.now();
  const queryVector = await embeddingService.embedQuery(text, options.embeddingOptions);
  const embedMs = Date.now() - embedStartedAt;

  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new Error('Embedding API returned an empty query vector');
  }

  const vectorStartedAt = Date.now();
  const rows = await KnowledgeChunk.aggregate([
    {
      $vectorSearch: {
        index: config.indexName,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(config.recallLimit, config.numCandidates),
        limit: Math.max(1, config.recallLimit),
        filter: { active: { $eq: true } },
      },
    },
    {
      $project: {
        sourceId: 1,
        category: 1,
        question: 1,
        answer: 1,
        vectorScore: { $meta: 'vectorSearchScore' },
      },
    },
  ]);
  const vectorSearchMs = Date.now() - vectorStartedAt;
  const results = rows.map(mapVectorResult);
  const totalMs = Date.now() - startedAt;

  const metrics = {
    embedMs,
    vectorSearchMs,
    totalMs,
    resultCount: results.length,
    indexName: config.indexName,
  };

  aiDebugLog('VECTOR', 'embedMs =', embedMs);
  aiDebugLog('VECTOR', 'vectorSearchMs =', vectorSearchMs);
  aiDebugLog('VECTOR', 'count =', results.length);
  aiDebugLog('VECTOR', 'index =', config.indexName);

  return { results, metrics };
}

module.exports = {
  searchKnowledgeVector,
  resolveVectorSearchConfig,
  assertMongoConnected,
  mapVectorResult,
};
