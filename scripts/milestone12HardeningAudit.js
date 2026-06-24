'use strict';

require('dotenv').config();
const connectDB = require('../config/db');
const LeadLifecycleEvent = require('../models/LeadLifecycleEvent');
const LeadLifecycleSnapshot = require('../models/LeadLifecycleSnapshot');
const { getLifecycleFunnel } = require('../services/analytics/leadLifecycleFunnelService');
const { getExecutiveSummary } = require('../services/analytics/analyticsExecutiveService');
const { getLifecycleValidationReport } = require('../services/analytics/leadLifecycleValidationService');
const { backfillLeadLifecycleEvents } = require('../services/analytics/leadLifecycleBackfillService');
const {
  buildCohortLeadMatch,
  loadCohortMembers,
} = require('../services/analytics/leadLifecycleAggregationService');
const { warmDefaultSnapshots } = require('../services/analytics/leadLifecycleSnapshotService');

async function timeFn(label, fn) {
  const start = Date.now();
  const result = await fn();
  return { label, ms: Date.now() - start, result };
}

async function explainAggregation() {
  const leadMatch = buildCohortLeadMatch({}, null);
  const cohortExplain = await LeadLifecycleEvent.aggregate([
    { $match: leadMatch },
    { $group: { _id: { phone10: '$phone10', productLine: '$productLine' } } },
    { $limit: 1 },
  ]).explain('executionStats');

  const phones = await LeadLifecycleEvent.distinct('phone10', { stage: 'lead' });
  const samplePhones = phones.slice(0, 200);
  const stageExplain = await LeadLifecycleEvent.aggregate([
    { $match: { phone10: { $in: samplePhones } } },
    { $sort: { transitionAt: 1 } },
    {
      $group: {
        _id: { phone10: '$phone10', productLine: '$productLine', stage: '$stage' },
        firstAt: { $first: '$transitionAt' },
      },
    },
    { $limit: 1 },
  ]).explain('executionStats');

  return {
    cohortLeadStage: summarizeExplain(cohortExplain),
    phoneStageRollup: summarizeExplain(stageExplain),
  };
}

function summarizeExplain(explain) {
  const stats = explain?.stages?.[0]?.executionStats || explain?.executionStats || {};
  return {
    executionTimeMs: stats.executionTimeMillis ?? null,
    totalDocsExamined: stats.totalDocsExamined ?? null,
    nReturned: stats.nReturned ?? null,
  };
}

async function listIndexes() {
  const [eventIndexes, snapshotIndexes, eventCount, snapshotCount] = await Promise.all([
    LeadLifecycleEvent.collection.getIndexes(),
    LeadLifecycleSnapshot.collection.getIndexes(),
    LeadLifecycleEvent.countDocuments({}),
    LeadLifecycleSnapshot.countDocuments({}),
  ]);
  return { eventIndexes, snapshotIndexes, eventCount, snapshotCount };
}

async function idempotencyProof() {
  const before = await LeadLifecycleEvent.countDocuments({});
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const stats = await backfillLeadLifecycleEvents({ clearExisting: false });
    const after = await LeadLifecycleEvent.countDocuments({});
    runs.push({ run: i + 1, stats, after });
  }
  const dupDedupe = await LeadLifecycleEvent.aggregate([
    { $group: { _id: '$dedupeKey', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: 'n' },
  ]);
  return {
    before,
    runs,
    stable: runs.every((r) => r.after === before),
    duplicateDedupeKeys: dupDedupe[0]?.n || 0,
  };
}

function scoreReadiness({ timing, idempotency, validation, indexes }) {
  let score = 0;
  const notes = [];

  const funnelMs = timing.find((t) => t.label === 'funnel_warm')?.ms ?? 99999;
  const execMs = timing.find((t) => t.label === 'executive_warm')?.ms ?? 99999;
  const valMs = timing.find((t) => t.label === 'validation_warm')?.ms ?? 99999;

  if (funnelMs < 2000) score += 20;
  else notes.push(`funnel warm ${funnelMs}ms > 2s`);
  if (execMs < 2000) score += 20;
  else notes.push(`executive warm ${execMs}ms > 2s`);
  if (valMs < 2000) score += 20;
  else notes.push(`validation warm ${valMs}ms > 2s`);

  if (idempotency.stable && idempotency.duplicateDedupeKeys === 0) score += 20;
  else notes.push('idempotency or dedupe duplicates failing');

  const alignment = validation?.meta?.alignmentPct ?? 0;
  if (alignment >= 70) score += 10;
  else notes.push(`alignment ${alignment}% < 70%`);

  const hasCompound = Object.keys(indexes.eventIndexes).some((k) =>
    k.includes('productLine_1_stage_1_phone10_1')
  );
  if (hasCompound) score += 5;
  else notes.push('missing compound index productLine+stage+phone10');

  if (indexes.snapshotCount > 0) score += 5;
  else notes.push('no snapshots materialized');

  return { score, max: 100, notes };
}

async function main() {
  await connectDB();
  const out = {
    milestone: '1.2',
    generatedAt: new Date().toISOString(),
    snapshotStrategy: {
      model: 'LeadLifecycleSnapshot',
      key: '{ rangeKey, productLine }',
      countingMethod: 'distinct_phone',
      invalidation: 'eventCountAtGeneration !== LeadLifecycleEvent.estimatedDocumentCount() or after backfill',
      servedBy: ['GET /analytics/lifecycle/funnel', 'GET /analytics/executive/summary', 'GET /analytics/lifecycle/validation'],
    },
  };

  out.indexes = await listIndexes();
  out.explain = await explainAggregation();

  await warmDefaultSnapshots({});
  out.timingCold = await Promise.all([
    timeFn('funnel_cold', async () => {
      await LeadLifecycleSnapshot.deleteMany({});
      return getLifecycleFunnel({ productLine: 'all' });
    }),
    timeFn('executive_cold', async () => {
      await LeadLifecycleSnapshot.deleteMany({});
      return getExecutiveSummary({});
    }),
    timeFn('validation_cold', async () => {
      await LeadLifecycleSnapshot.deleteMany({});
      return getLifecycleValidationReport({});
    }),
  ]);

  await warmDefaultSnapshots({});
  out.timing = await Promise.all([
    timeFn('funnel_warm', () => getLifecycleFunnel({ productLine: 'all' })),
    timeFn('executive_warm', () => getExecutiveSummary({})),
    timeFn('validation_warm', () => getLifecycleValidationReport({})),
  ]);

  out.validation = await getLifecycleValidationReport({});
  out.idempotency = await idempotencyProof();
  out.readiness = scoreReadiness({
    timing: out.timing,
    idempotency: out.idempotency,
    validation: out.validation,
    indexes: out.indexes,
  });

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
