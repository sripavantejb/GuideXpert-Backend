'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const KnowledgeChunk = require('../models/KnowledgeChunk');
const embeddingService = require('../services/ai/embeddingService');
const vectorService = require('../services/chatbot/knowledgeVectorSearchService');

const originalEmbedQuery = embeddingService.embedQuery;
const originalAggregate = KnowledgeChunk.aggregate.bind(KnowledgeChunk);

afterEach(() => {
  embeddingService.embedQuery = originalEmbedQuery;
  KnowledgeChunk.aggregate = originalAggregate;
});

describe('knowledgeVectorSearchService', () => {
  test('assertMongoConnected throws when disconnected', () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      value: 0,
    });

    assert.throws(() => vectorService.assertMongoConnected(), /MongoDB is not connected/);

    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      value: originalReadyState,
    });
  });

  test('searchKnowledgeVector maps aggregate results', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      value: 1,
    });

    embeddingService.embedQuery = async () => Array.from({ length: 1024 }, () => 0.1);

    let aggregatePipeline = null;
    KnowledgeChunk.aggregate = async (pipeline) => {
      aggregatePipeline = pipeline;
      return [
        {
          sourceId: 15,
          category: 'niit_counselling',
          question: 'What exactly is NIAT?',
          answer: 'NIAT answer',
          vectorScore: 0.91,
        },
      ];
    };

    const output = await vectorService.searchKnowledgeVector('What is NIAT?', {
      indexName: 'knowledge_vector_index',
      recallLimit: 20,
    });

    assert.equal(output.results.length, 1);
    assert.equal(output.results[0].id, 15);
    assert.equal(output.results[0].vectorScore, 0.91);
    assert.equal(output.metrics.indexName, 'knowledge_vector_index');
    assert.equal(aggregatePipeline[0].$vectorSearch.index, 'knowledge_vector_index');
    assert.equal(aggregatePipeline[0].$vectorSearch.path, 'embedding');
    assert.deepEqual(aggregatePipeline[0].$vectorSearch.filter, { active: { $eq: true } });
  });
});
