'use strict';

require('dotenv').config();
const connectDB = require('../config/db');
const LeadLifecycleEvent = require('../models/LeadLifecycleEvent');
const { getLifecycleFunnel } = require('../services/analytics/leadLifecycleFunnelService');
const { getExecutiveSummary } = require('../services/analytics/analyticsExecutiveService');
const { getLifecycleValidationReport } = require('../services/analytics/leadLifecycleValidationService');
const { backfillLeadLifecycleEvents } = require('../services/analytics/leadLifecycleBackfillService');

async function time(label, fn) {
  const t0 = Date.now();
  await fn();
  return { label, ms: Date.now() - t0 };
}

async function main() {
  await connectDB();
  const eventCount = await LeadLifecycleEvent.countDocuments({});

  const timingWarm = await Promise.all([
    time('funnel', () => getLifecycleFunnel({ productLine: 'all' })),
    time('executive', () => getExecutiveSummary({})),
    time('validation', () => getLifecycleValidationReport({})),
  ]);

  const before = eventCount;
  const run = await backfillLeadLifecycleEvents({ clearExisting: false });
  const after = await LeadLifecycleEvent.countDocuments({});

  const dup = await LeadLifecycleEvent.aggregate([
    { $group: { _id: '$dedupeKey', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: 'n' },
  ]);

  const validation = await getLifecycleValidationReport({});

  console.log(
    JSON.stringify(
      {
        eventCount: before,
        timingWarm,
        idempotency: {
          before,
          after,
          inserted: run.inserted,
          matched: run.matched,
          modified: run.modified,
          stable: before === after && (run.inserted || 0) === 0,
          duplicateDedupeKeys: dup[0]?.n || 0,
        },
        validationAlignmentPct: validation.meta?.alignmentPct,
        validationAligned: validation.meta?.alignedCount,
        validationTotal: validation.meta?.totalComparisons,
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
