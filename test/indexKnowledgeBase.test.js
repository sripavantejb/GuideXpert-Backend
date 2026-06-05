'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChunkDraft,
  shouldSkipEmbedding,
  listOrphanSourceIds,
  buildUpsertPayload,
  planKnowledgeIndex,
} = require('../services/knowledge/knowledgeIndexService');

describe('knowledgeIndexService', () => {
  test('shouldSkipEmbedding skips unchanged hash with matching dimensions', () => {
    const skip = shouldSkipEmbedding(
      { contentHash: 'abc', embedding: Array.from({ length: 1024 }, () => 0.1) },
      'abc',
      1024,
      false
    );
    assert.equal(skip, true);
  });

  test('shouldSkipEmbedding re-embeds when force is true', () => {
    const skip = shouldSkipEmbedding(
      { contentHash: 'abc', embedding: Array.from({ length: 1024 }, () => 0.1) },
      'abc',
      1024,
      true
    );
    assert.equal(skip, false);
  });

  test('listOrphanSourceIds returns ids not in current knowledge base', () => {
    const orphans = listOrphanSourceIds([1, 2, 99], [1, 2, 3]);
    assert.deepEqual(orphans, [99]);
  });

  test('buildChunkDraft includes stable content hash', () => {
    const draft = buildChunkDraft({
      id: 11,
      category: 'niit_counselling',
      question: 'How is this counselling different from normal counselling?',
      answer: 'Personalized guidance is provided.',
    });

    assert.equal(draft.sourceId, 11);
    assert.match(draft.embedText, /Category: niit_counselling/);
    assert.match(draft.contentHash, /^[a-f0-9]{64}$/);
  });

  test('planKnowledgeIndex separates embed and skip sets', () => {
    const entries = [
      { id: 1, category: 'a', question: 'Q1?', answer: 'A1' },
      { id: 2, category: 'a', question: 'Q2?', answer: 'A2' },
    ];
    const draft1 = buildChunkDraft(entries[0]);
    const existing = new Map([
      [1, { sourceId: 1, contentHash: draft1.contentHash, embedding: Array(1024).fill(0.2) }],
    ]);

    const plan = planKnowledgeIndex(entries, existing, { dimensions: 1024 });

    assert.deepEqual(plan.skippedSourceIds, [1]);
    assert.equal(plan.toEmbed.length, 1);
    assert.equal(plan.toEmbed[0].sourceId, 2);
    assert.deepEqual(plan.orphanSourceIds, []);
  });

  test('buildUpsertPayload stores embedding metadata', () => {
    const draft = buildChunkDraft({
      id: 11,
      category: 'niit_counselling',
      question: 'Q?',
      answer: 'A',
    });
    const vector = Array.from({ length: 1024 }, () => 0.5);
    const payload = buildUpsertPayload(draft, vector, {
      model: 'nvidia/llama-nemotron-embed-1b-v2',
      dimensions: 1024,
    }, '12345');

    assert.equal(payload.sourceId, 11);
    assert.equal(payload.embedding.length, 1024);
    assert.equal(payload.embeddingModel, 'nvidia/llama-nemotron-embed-1b-v2');
    assert.equal(payload.embeddingDimensions, 1024);
    assert.equal(payload.active, true);
    assert.equal(payload.sourceVersion, '12345');
  });
});
