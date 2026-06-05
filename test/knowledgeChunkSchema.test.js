'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const KnowledgeChunk = require('../models/KnowledgeChunk');

describe('KnowledgeChunk schema', () => {
  test('schema defines required fields and unique sourceId/chunkIndex index', () => {
    const paths = KnowledgeChunk.schema.paths;
    assert.ok(paths.sourceId);
    assert.ok(paths.chunkIndex);
    assert.ok(paths.embedText);
    assert.ok(paths.embedding);
    assert.ok(paths.embeddingModel);
    assert.ok(paths.embeddingDimensions);
    assert.ok(paths.contentHash);
    assert.ok(paths.indexedAt);

    const indexes = KnowledgeChunk.schema.indexes();
    const uniqueCompound = indexes.find(
      ([fields, options]) =>
        fields.sourceId === 1 && fields.chunkIndex === 1 && options?.unique === true
    );
    assert.ok(uniqueCompound, 'expected unique compound index on sourceId + chunkIndex');
  });
});
