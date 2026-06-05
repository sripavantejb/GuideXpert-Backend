#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../config/db');
const KnowledgeChunk = require('../models/KnowledgeChunk');
const { embedDocuments, resolveEmbeddingConfig } = require('../services/ai/embeddingService');
const {
  auditKnowledgeBase,
  loadKnowledgeBase,
  KNOWLEDGE_BASE_PATH,
} = require('../utils/knowledgeBaseAudit');
const {
  buildUpsertPayload,
  getKnowledgeBaseSourceVersion,
  planKnowledgeIndex,
} = require('../services/knowledge/knowledgeIndexService');

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  };
}

function preflight() {
  const missing = [];
  const config = resolveEmbeddingConfig();

  if (!String(process.env.MONGODB_URI || '').trim() && process.env.NODE_ENV === 'production') {
    missing.push('MONGODB_URI');
  }
  if (!config.apiKey) {
    missing.push('EMBEDDING_API_KEY or LLM_API_KEY');
  }
  if (!config.baseURL) {
    missing.push('EMBEDDING_BASE_URL or LLM_BASE_URL');
  }
  if (!config.model) {
    missing.push('EMBEDDING_MODEL');
  }

  if (missing.length) {
    console.error('FAIL: missing env:', missing.join(', '));
    process.exit(1);
  }
}

async function loadExistingChunks() {
  const rows = await KnowledgeChunk.find({ chunkIndex: 0 })
    .select('sourceId contentHash embedding')
    .lean();
  return new Map(rows.map((row) => [row.sourceId, row]));
}

async function upsertChunk(payload) {
  await KnowledgeChunk.updateOne(
    { sourceId: payload.sourceId, chunkIndex: payload.chunkIndex },
    { $set: payload },
    { upsert: true }
  );
}

async function deactivateOrphans(sourceIds) {
  if (sourceIds.length === 0) return 0;

  const result = await KnowledgeChunk.updateMany(
    { sourceId: { $in: sourceIds }, active: true },
    { $set: { active: false } }
  );
  return result.modifiedCount || 0;
}

async function main() {
  const { dryRun, force } = parseArgs(process.argv.slice(2));
  preflight();

  const entries = loadKnowledgeBase();
  const audit = auditKnowledgeBase(entries);
  if (!audit.ok) {
    console.error('FAIL: knowledge base audit failed');
    for (const error of audit.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  if (dryRun) {
    const plan = planKnowledgeIndex(entries, new Map(), { force });
    console.log('Knowledge base indexing plan');
    console.log(`- entries: ${entries.length}`);
    console.log(`- to embed: ${plan.toEmbed.length}`);
    console.log(`- skipped (unchanged): ${plan.skippedSourceIds.length}`);
    console.log(`- orphan sourceIds: ${plan.orphanSourceIds.length}`);
    console.log(`- dryRun: ${dryRun}`);
    console.log(`- force: ${force}`);
    return;
  }

  await connectDB();
  const existingBySourceId = await loadExistingChunks();
  const plan = planKnowledgeIndex(entries, existingBySourceId, { force });
  const sourceVersion = getKnowledgeBaseSourceVersion(KNOWLEDGE_BASE_PATH);

  console.log('Knowledge base indexing plan');
  console.log(`- entries: ${entries.length}`);
  console.log(`- to embed: ${plan.toEmbed.length}`);
  console.log(`- skipped (unchanged): ${plan.skippedSourceIds.length}`);
  console.log(`- orphan sourceIds: ${plan.orphanSourceIds.length}`);
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- force: ${force}`);

  await KnowledgeChunk.syncIndexes();

  let embeddedCount = 0;
  const config = plan.config;

  for (let i = 0; i < plan.toEmbed.length; i += config.batchSize) {
    const batch = plan.toEmbed.slice(i, i + config.batchSize);
    const vectors = await embedDocuments(
      batch.map((draft) => draft.embedText),
      config
    );

    for (let j = 0; j < batch.length; j += 1) {
      const payload = buildUpsertPayload(batch[j], vectors[j], config, sourceVersion);
      await upsertChunk(payload);
      embeddedCount += 1;
    }
  }

  const deactivatedCount = await deactivateOrphans(plan.orphanSourceIds);

  console.log('Knowledge base indexing complete');
  console.log(`- embedded: ${embeddedCount}`);
  console.log(`- skipped: ${plan.skippedSourceIds.length}`);
  console.log(`- deactivated: ${deactivatedCount}`);
}

main()
  .then(async () => {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('FAIL:', error.message);
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
