/**
 * P3: Backfill WhatsAppReminderJob rows for registered submissions with future slots.
 *
 * Usage:
 *   node scripts/backfillWhatsAppReminderJobs.js              # dry-run
 *   node scripts/backfillWhatsAppReminderJobs.js --execute    # write jobs
 *   node scripts/backfillWhatsAppReminderJobs.js --execute --batch-size=200
 *   node scripts/backfillWhatsAppReminderJobs.js --execute --resume-from=<objectId>
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const { ensureReminderJobsForSubmission } = require('../services/whatsappReminderScheduler');
const { computeExpiresAt } = require('../utils/waReminderJobExpiration');

const CHECKPOINT_FILE = path.join(__dirname, '..', '.wa-reminder-backfill-checkpoint.json');

function parseArgs(argv) {
  const args = argv.slice(2);
  const execute = args.includes('--execute');
  let batchSize = 100;
  let resumeFrom = null;
  let batchDelayMs = 0;
  for (const a of args) {
    if (a.startsWith('--batch-size=')) {
      const n = parseInt(a.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) batchSize = Math.min(5000, n);
    }
    if (a.startsWith('--resume-from=')) {
      resumeFrom = a.split('=')[1];
    }
    if (a.startsWith('--batch-delay-ms=')) {
      batchDelayMs = parseInt(a.split('=')[1], 10) || 0;
    }
  }
  const graceMs = parseInt(process.env.WA_REMINDER_BACKFILL_GRACE_MS || String(24 * 60 * 60 * 1000), 10);
  return { execute, batchSize, graceMs: Number.isFinite(graceMs) ? graceMs : 86400000, resumeFrom, batchDelayMs };
}

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function saveCheckpoint(lastId, stats) {
  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify({ lastId: String(lastId), updatedAt: new Date().toISOString(), stats }, null, 2)
  );
}

function mergeEnsureStats(stats, result) {
  if (result.error) {
    stats.errors += 1;
    stats.errorReasons[result.error] = (stats.errorReasons[result.error] || 0) + 1;
    return;
  }
  if (result.duplicatePrevented) {
    stats.duplicatePrevented += result.duplicatePrevented;
  }
  for (const j of result.jobs || []) {
    if (j.created) stats.created += 1;
    else if (j.rescheduled) stats.rescheduled += 1;
    else stats.updated += 1;
    if (j.duplicatePrevented) stats.duplicatePrevented += 1;
    if (j.state === 'skipped') stats.skippedJobs += 1;
  }
}

function emptyStats(mode) {
  return {
    mode,
    scanned: 0,
    processed: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    wouldExpire: 0,
    created: 0,
    updated: 0,
    rescheduled: 0,
    skippedJobs: 0,
    duplicatePrevented: 0,
    expiredIgnored: 0,
    errors: 0,
    errorReasons: {}
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dryRunSubmission(submission, now) {
  const slotAt = submission.step3Data?.slotDate;
  if (!slotAt) return { wouldCreate: 0, wouldUpdate: 0, wouldExpire: 0 };
  const existing = await WhatsAppReminderJob.countDocuments({ formSubmissionId: submission._id });
  const expiresAt = computeExpiresAt('pre4hr', slotAt);
  const expired = expiresAt && new Date(expiresAt).getTime() <= now.getTime();
  if (expired) return { wouldCreate: 0, wouldUpdate: 0, wouldExpire: existing < 3 ? 3 - existing : 0 };
  if (existing >= 3) return { wouldCreate: 0, wouldUpdate: 0, wouldExpire: 0 };
  return { wouldCreate: 3 - existing, wouldUpdate: existing > 0 ? 1 : 0, wouldExpire: 0 };
}

async function runBackfill(opts = {}) {
  const execute = opts.execute === true;
  const batchSize = opts.batchSize != null ? opts.batchSize : 100;
  const graceMs = opts.graceMs != null ? opts.graceMs : 86400000;
  const batchDelayMs = opts.batchDelayMs || 0;
  const now = opts.now || new Date();
  const stats = emptyStats(execute ? 'EXECUTE' : 'DRY-RUN');

  let resumeFromId = opts.resumeFrom;
  if (!resumeFromId) {
    const cp = loadCheckpoint();
    if (cp && cp.lastId) resumeFromId = cp.lastId;
  }

  const slotCutoff = new Date(now.getTime() - graceMs);
  const query = {
    isRegistered: true,
    'step3Data.slotDate': { $gt: slotCutoff }
  };
  if (resumeFromId && mongoose.Types.ObjectId.isValid(String(resumeFromId))) {
    query._id = { $gt: new mongoose.Types.ObjectId(String(resumeFromId)) };
  }

  const cursor = FormSubmission.find(query)
    .select('_id phone step3Data.slotDate isRegistered')
    .sort({ _id: 1 })
    .lean()
    .cursor();

  let batch = [];
  let lastProcessedId = resumeFromId || null;

  for await (const doc of cursor) {
    stats.scanned += 1;
    batch.push(doc);
    if (batch.length < batchSize) continue;

    for (const submission of batch) {
      stats.processed += 1;
      lastProcessedId = submission._id;
      if (!execute) {
        // eslint-disable-next-line no-await-in-loop
        const dry = await dryRunSubmission(submission, now);
        stats.wouldCreate += dry.wouldCreate;
        stats.wouldUpdate += dry.wouldUpdate;
        stats.wouldExpire += dry.wouldExpire;
        if (dry.wouldExpire) stats.expiredIgnored += dry.wouldExpire;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await ensureReminderJobsForSubmission(submission, { now });
      mergeEnsureStats(stats, result);
    }
    if (execute && lastProcessedId) saveCheckpoint(lastProcessedId, stats);
    batch = [];
    if (batchDelayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(batchDelayMs);
    }
  }

  if (batch.length) {
    for (const submission of batch) {
      stats.processed += 1;
      lastProcessedId = submission._id;
      if (!execute) {
        // eslint-disable-next-line no-await-in-loop
        const dry = await dryRunSubmission(submission, now);
        stats.wouldCreate += dry.wouldCreate;
        stats.wouldUpdate += dry.wouldUpdate;
        stats.wouldExpire += dry.wouldExpire;
        if (dry.wouldExpire) stats.expiredIgnored += dry.wouldExpire;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await ensureReminderJobsForSubmission(submission, { now });
      mergeEnsureStats(stats, result);
    }
    if (execute && lastProcessedId) saveCheckpoint(lastProcessedId, stats);
  }

  stats.lastProcessedId = lastProcessedId ? String(lastProcessedId) : null;
  return stats;
}

async function main() {
  const { execute, batchSize, graceMs, resumeFrom, batchDelayMs } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing in environment');

  console.log(`[${execute ? 'EXECUTE' : 'DRY-RUN'}] Connecting (batchSize=${batchSize})...`);
  await mongoose.connect(uri);
  try {
    const stats = await runBackfill({ execute, batchSize, graceMs, resumeFrom, batchDelayMs });
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  mergeEnsureStats,
  emptyStats,
  runBackfill,
  dryRunSubmission,
  CHECKPOINT_FILE
};
