/**
 * Idempotent backfill: set reconcileDerivedFailure=true on historical failed rows
 * from old one-phase reconcile (retryExclusionMeta.note reconcile_*).
 *
 * Usage:
 *   node scripts/backfillReconcileDerivedFailure.js           # dry-run (default)
 *   node scripts/backfillReconcileDerivedFailure.js --execute
 *   node scripts/backfillReconcileDerivedFailure.js --execute --batch-size=500
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { PERMANENT_EXCLUSION_REASONS } = require('../utils/whatsappRetryRules');

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  const dryRun = !execute;
  let batchSize = 500;
  for (const a of argv) {
    const m = /^--batch-size=(\d+)$/.exec(a);
    if (m) batchSize = Math.min(Math.max(parseInt(m[1], 10) || 500, 1), 2000);
  }
  return { dryRun, batchSize };
}

function buildMatchFilter() {
  return {
    status: 'failed',
    reconcileDerivedFailure: { $ne: true },
    terminalFailureKind: { $ne: 'permanent' },
    retryExclusionReason: { $nin: PERMANENT_EXCLUSION_REASONS },
    $or: [
      { 'retryExclusionMeta.note': /^reconcile_stale_/ },
      { 'retryExclusionMeta.note': /^reconcile_finalize_/ },
      { 'retryExclusionMeta.note': 'reconcile_awaiting_final_dlr' }
    ]
  };
}

async function run() {
  const { dryRun, batchSize } = parseArgs();
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[backfill:wa-reconcile-derived] MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const match = buildMatchFilter();
  const stats = {
    mode: dryRun ? 'dry-run' : 'execute',
    batchSize,
    scanned: 0,
    matched: 0,
    updated: 0,
    skippedAlreadySet: 0,
    skippedPermanent: 0
  };

  let lastId = null;
  /* eslint-disable no-constant-condition */
  while (true) {
    const pageFilter = lastId ? { ...match, _id: { $gt: lastId } } : match;
    const rows = await WhatsAppMessageEvent.find(pageFilter)
      .select('_id status reconcileDerivedFailure terminalFailureKind retryExclusionReason retryExclusionMeta')
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (!rows.length) break;

    stats.scanned += rows.length;
    lastId = rows[rows.length - 1]._id;

    for (const row of rows) {
      if (row.reconcileDerivedFailure === true) {
        stats.skippedAlreadySet += 1;
        continue;
      }
      if (row.terminalFailureKind === 'permanent') {
        stats.skippedPermanent += 1;
        continue;
      }
      if (PERMANENT_EXCLUSION_REASONS.includes(row.retryExclusionReason)) {
        stats.skippedPermanent += 1;
        continue;
      }

      stats.matched += 1;
      if (!dryRun) {
        const res = await WhatsAppMessageEvent.updateOne(
          { _id: row._id, status: 'failed', reconcileDerivedFailure: { $ne: true } },
          { $set: { reconcileDerivedFailure: true, updatedAt: new Date() } }
        );
        if (res.modifiedCount) stats.updated += 1;
      }
    }

    if (rows.length < batchSize) break;
  }
  /* eslint-enable no-constant-condition */

  console.log('[backfill:wa-reconcile-derived] done', stats);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((e) => {
    console.error('[backfill:wa-reconcile-derived] fatal', e);
    process.exit(1);
  });
}

module.exports = { buildMatchFilter };
