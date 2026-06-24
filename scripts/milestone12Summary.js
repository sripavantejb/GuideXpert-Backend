'use strict';

require('dotenv').config();
const connectDB = require('../config/db');
const LeadLifecycleEvent = require('../models/LeadLifecycleEvent');
const LeadLifecycleSnapshot = require('../models/LeadLifecycleSnapshot');
const { getLifecycleFunnel } = require('../services/analytics/leadLifecycleFunnelService');
const { getExecutiveSummary } = require('../services/analytics/analyticsExecutiveService');
const { getLifecycleValidationReport } = require('../services/analytics/leadLifecycleValidationService');
const { backfillLeadLifecycleEvents } = require('../services/analytics/leadLifecycleBackfillService');
const { warmDefaultSnapshots } = require('../services/analytics/leadLifecycleSnapshotService');

async function time(label, fn) {
  const t0 = Date.now();
  await fn();
  return { label, ms: Date.now() - t0 };
}

async function main() {
  await connectDB();
  await warmDefaultSnapshots({});

  const timingWarm = await Promise.all([
    time('funnel', () => getLifecycleFunnel({ productLine: 'all' })),
    time('executive', () => getExecutiveSummary({})),
    time('validation', () => getLifecycleValidationReport({})),
  ]);

  const before = await LeadLifecycleEvent.countDocuments({});
  const run1 = await backfillLeadLifecycleEvents({ clearExisting: false });
  const after1 = await LeadLifecycleEvent.countDocuments({});
  const run2 = await backfillLeadLifecycleEvents({ clearExisting: false });
  const after2 = await LeadLifecycleEvent.countDocuments({});

  const dup = await LeadLifecycleEvent.aggregate([
    { $group: { _id: '$dedupeKey', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: 'n' },
  ]);

  const validation = await getLifecycleValidationReport({});
  const indexes = await LeadLifecycleEvent.collection.getIndexes();
  const snapshotCount = await LeadLifecycleSnapshot.countDocuments({});

  const sub2 = timingWarm.every((t) => t.ms < 2000);
  const idempotent = before === after1 && after1 === after2 && (run1.inserted || 0) === 0 && (run2.inserted || 0) === 0;

  let score = 0;
  if (timingWarm[0].ms < 2000) score += 20;
  if (timingWarm[1].ms < 2000) score += 20;
  if (timingWarm[2].ms < 2000) score += 20;
  if (idempotent && !(dup[0]?.n)) score += 20;
  if ((validation.meta?.alignmentPct || 0) >= 70) score += 10;
  if (indexes.productLine_1_stage_1_phone10_1) score += 5;
  if (snapshotCount > 0) score += 5;

  console.log(
    JSON.stringify(
      {
        eventCount: before,
        snapshotCount,
        timingWarm,
        sub2SecondTargetMet: sub2,
        idempotency: { before, after1, after2, run1Inserted: run1.inserted, run2Inserted: run2.inserted, stable: idempotent, duplicateDedupeKeys: dup[0]?.n || 0 },
        validationAlignmentPct: validation.meta?.alignmentPct,
        validationAligned: validation.meta?.alignedCount,
        validationTotal: validation.meta?.totalComparisons,
        intentionalDifferences: validation.meta?.intentionalDifferenceCount,
        productionReadinessScore: score,
        compoundIndexes: ['productLine_1_stage_1_phone10_1', 'productLine_1_phone10_1'],
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
