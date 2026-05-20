/**
 * Backfill IIT counselling WhatsAppReminderJob rows for Section-2 submissions with future slots.
 *
 * Usage:
 *   node scripts/backfillIitReminderJobs.js              # dry-run (default)
 *   node scripts/backfillIitReminderJobs.js --execute    # write jobs
 *   node scripts/backfillIitReminderJobs.js --execute --include-today
 */
require('dotenv').config();
const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { ensureIitReminderJobsForSubmission } = require('../services/iitReminderScheduler');

const IIT_LANGUAGES = ['Telugu', 'Hindi'];

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    execute: args.includes('--execute'),
    includeToday: args.includes('--include-today'),
  };
}

function mergeStats(stats, result, submissionId) {
  stats.processed += 1;
  if (result.error) {
    stats.errors += 1;
    stats.errorReasons[result.error] = (stats.errorReasons[result.error] || 0) + 1;
    stats.errorSamples.push({ submissionId, error: result.error, detail: result.detail, messageKind: result.messageKind });
    return;
  }
  if (result.duplicatePrevented) {
    stats.duplicatePrevented += result.duplicatePrevented;
  }
  for (const j of result.jobs || []) {
    const kind = j.messageKind || 'unknown';
    if (!stats.byMessageKind[kind]) {
      stats.byMessageKind[kind] = { pending: 0, skipped: 0, other: 0, created: 0, rescheduled: 0 };
    }
    const bucket = stats.byMessageKind[kind];
    if (j.created) bucket.created += 1;
    if (j.rescheduled) bucket.rescheduled += 1;
    if (j.state === 'pending') bucket.pending += 1;
    else if (j.state === 'skipped') {
      bucket.skipped += 1;
      stats.skippedJobs += 1;
      if (!j.templateIdEnvKey) {
        stats.skipReasons.iit_template_env_missing =
          (stats.skipReasons.iit_template_env_missing || 0) + 1;
      }
    } else bucket.other += 1;
  }
}

function emptyStats(mode) {
  return {
    mode,
    scanned: 0,
    processed: 0,
    errors: 0,
    skippedJobs: 0,
    duplicatePrevented: 0,
    errorReasons: {},
    skipReasons: {},
    byMessageKind: {},
    errorSamples: [],
  };
}

async function runBackfill(opts = {}) {
  const execute = opts.execute === true;
  const now = opts.now || new Date();
  const stats = emptyStats(execute ? 'EXECUTE' : 'DRY-RUN');

  const slotFilter = { $gt: now };
  if (opts.includeToday) {
    const startOfTodayUtc = new Date(now);
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    slotFilter.$gte = startOfTodayUtc;
  }

  const query = {
    counsellingSlotInstantUtc: slotFilter,
    'iitCounselling.section2Data.preferredLanguage': { $in: IIT_LANGUAGES },
    phone: { $exists: true, $ne: '' },
  };

  const cursor = IitCounsellingSubmission.find(query).sort({ _id: 1 }).lean().cursor();

  for await (const doc of cursor) {
    stats.scanned += 1;
    if (!execute) {
      stats.processed += 1;
      continue;
    }
    try {
      const result = await ensureIitReminderJobsForSubmission(doc, { now });
      mergeStats(stats, result, doc._id.toString());
    } catch (err) {
      stats.errors += 1;
      stats.errorReasons.unhandled = (stats.errorReasons.unhandled || 0) + 1;
      stats.errorSamples.push({
        submissionId: doc._id.toString(),
        error: 'unhandled',
        detail: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
      });
    }
  }

  return stats;
}

async function main() {
  const { execute, includeToday } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI (or MONGO_URI) is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
  console.log('Syncing WhatsAppReminderJob indexes (fixes partial unique on formSubmissionId)…');
  await WhatsAppReminderJob.syncIndexes();
  console.log(`IIT reminder job backfill (${execute ? 'EXECUTE' : 'DRY-RUN'})…`);

  const stats = await runBackfill({ execute, includeToday, now: new Date() });
  console.log(JSON.stringify(stats, null, 2));

  if (!execute) {
    console.log('\nDry-run only — no writes. Re-run with --execute to create/update jobs.');
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runBackfill, parseArgs };
