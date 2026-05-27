/**
 * Backfill IitTeluguSmsReminderJob rows for Telugu Section-2 submissions with future slots.
 *
 * Usage:
 *   node scripts/backfillIitTeluguSmsJobs.js              # dry-run (default)
 *   node scripts/backfillIitTeluguSmsJobs.js --execute    # write jobs
 */
require('dotenv').config();
const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { ensureIitTeluguSmsJobsForSubmission } = require('../services/iitTeluguSmsReminderScheduler');

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    execute: args.includes('--execute'),
    includeToday: args.includes('--include-today'),
  };
}

async function runBackfill(opts = {}) {
  const execute = opts.execute === true;
  const now = opts.now || new Date();
  const stats = {
    mode: execute ? 'EXECUTE' : 'DRY-RUN',
    scanned: 0,
    processed: 0,
    errors: 0,
    skippedLanguage: 0,
  };

  const slotFilter = { $gt: now };
  if (opts.includeToday) {
    const startOfTodayUtc = new Date(now);
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    slotFilter.$gte = startOfTodayUtc;
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const cursor = IitCounsellingSubmission.find({
    submissionType: 'iitCounselling',
    counsellingSlotInstantUtc: slotFilter,
    'iitCounselling.section2Data.preferredLanguage': 'Telugu',
    'iitCounselling.section2Data.submittedAt': { $exists: true },
  })
    .select('_id phone counsellingSlotInstantUtc iitCounselling')
    .lean()
    .cursor();

  for await (const doc of cursor) {
    stats.scanned += 1;
    if (!execute) {
      console.log('[dry-run] would schedule Telugu SMS for', String(doc._id), doc.phone);
      stats.processed += 1;
      continue;
    }
    const result = await ensureIitTeluguSmsJobsForSubmission(doc, { now });
    stats.processed += 1;
    if (result.error) {
      stats.errors += 1;
      console.warn('[execute] error', String(doc._id), result.error, result.detail || '');
    } else if (result.skipped) {
      stats.skippedLanguage += 1;
    } else {
      console.log('[execute] scheduled', String(doc._id), (result.jobs || []).length, 'jobs');
    }
  }

  await mongoose.disconnect();
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  runBackfill({ execute: args.execute, includeToday: args.includeToday }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runBackfill };
