'use strict';

const fs = require('fs');
const { buildEmbedText } = require('../../utils/knowledgeEmbedText');
const { hashEmbedText } = require('../../utils/knowledgeContentHash');
const { resolveEmbeddingConfig } = require('../ai/embeddingService');

function buildChunkDraft(entry, chunkIndex = 0) {
  const embedText = buildEmbedText(entry);
  return {
    sourceId: entry.id,
    chunkIndex,
    category: String(entry.category || '').trim(),
    question: String(entry.question || '').trim(),
    answer: String(entry.answer || '').trim(),
    embedText,
    contentHash: hashEmbedText(embedText),
  };
}

function shouldSkipEmbedding(existingChunk, contentHash, dimensions, force = false) {
  if (force) return false;
  if (!existingChunk) return false;
  if (existingChunk.contentHash !== contentHash) return false;
  if (!Array.isArray(existingChunk.embedding)) return false;
  return existingChunk.embedding.length === dimensions;
}

function listOrphanSourceIds(existingSourceIds, currentSourceIds) {
  const current = new Set(currentSourceIds);
  return [...existingSourceIds].filter((sourceId) => !current.has(sourceId));
}

function getKnowledgeBaseSourceVersion(filePath) {
  const stats = fs.statSync(filePath);
  return String(stats.mtimeMs);
}

function buildUpsertPayload(draft, vector, config, sourceVersion, indexedAt = new Date()) {
  return {
    sourceId: draft.sourceId,
    chunkIndex: draft.chunkIndex,
    category: draft.category,
    question: draft.question,
    answer: draft.answer,
    embedText: draft.embedText,
    contentHash: draft.contentHash,
    embedding: vector,
    embeddingModel: config.model,
    embeddingDimensions: config.dimensions,
    active: true,
    sourceVersion,
    indexedAt,
  };
}

function planKnowledgeIndex(entries, existingBySourceId, options = {}) {
  const config = resolveEmbeddingConfig(options);
  const force = Boolean(options.force);
  const drafts = entries.map((entry) => buildChunkDraft(entry, 0));

  const toEmbed = [];
  const skipped = [];

  for (const draft of drafts) {
    const existing = existingBySourceId.get(draft.sourceId) || null;
    if (shouldSkipEmbedding(existing, draft.contentHash, config.dimensions, force)) {
      skipped.push(draft.sourceId);
    } else {
      toEmbed.push(draft);
    }
  }

  const orphanSourceIds = listOrphanSourceIds(
    existingBySourceId.keys(),
    drafts.map((draft) => draft.sourceId)
  );

  return {
    config,
    drafts,
    toEmbed,
    skippedSourceIds: skipped,
    orphanSourceIds,
  };
}

module.exports = {
  buildChunkDraft,
  shouldSkipEmbedding,
  listOrphanSourceIds,
  getKnowledgeBaseSourceVersion,
  buildUpsertPayload,
  planKnowledgeIndex,
};
