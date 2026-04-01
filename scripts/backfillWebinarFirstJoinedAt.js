require('dotenv').config();
const mongoose = require('mongoose');
const WebinarProgress = require('../models/WebinarProgress');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return { commit: args.has('--commit') };
}

function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickEarliest(dates) {
  let earliest = null;
  for (const d of dates) {
    if (!d) continue;
    if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
  }
  return earliest;
}

function deriveEarliestActivity(doc) {
  const candidates = [];
  candidates.push(asDate(doc.createdAt));
  candidates.push(asDate(doc.lastActivityAt));
  candidates.push(asDate(doc.lastActivityEvent?.at));
  candidates.push(asDate(doc.certificateDownloadedAt));

  const modules = doc.modules || {};
  for (const mod of Object.values(modules)) {
    if (!mod || typeof mod !== 'object') continue;
    candidates.push(asDate(mod.unlockedAt));
    candidates.push(asDate(mod.completedAt));
  }

  return pickEarliest(candidates);
}

async function run() {
  const { commit } = parseArgs(process.argv);
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing in environment');

  const stats = {
    mode,
    scanned: 0,
    alreadySet: 0,
    missingSource: 0,
    wouldUpdate: 0,
    updated: 0,
    failed: 0,
  };

  try {
    console.log(`[${mode}] Connecting...`);
    await mongoose.connect(uri);

    const docs = await WebinarProgress.find(
      {},
      {
        _id: 1,
        phone: 1,
        firstJoinedAt: 1,
        createdAt: 1,
        lastActivityAt: 1,
        lastActivityEvent: 1,
        certificateDownloadedAt: 1,
        modules: 1,
      }
    ).lean();
    stats.scanned = docs.length;

    for (const doc of docs) {
      try {
        if (doc.firstJoinedAt) {
          stats.alreadySet += 1;
          continue;
        }
        const derived = deriveEarliestActivity(doc);
        if (!derived) {
          stats.missingSource += 1;
          continue;
        }
        stats.wouldUpdate += 1;
        if (!commit) continue;
        const result = await WebinarProgress.updateOne(
          { _id: doc._id, firstJoinedAt: null },
          { $set: { firstJoinedAt: derived } }
        );
        if (result.modifiedCount > 0) stats.updated += 1;
      } catch (err) {
        stats.failed += 1;
      }
    }

    console.log('\n===== Webinar firstJoinedAt backfill =====');
    console.log(`Mode: ${stats.mode}`);
    console.log(`Scanned: ${stats.scanned}`);
    console.log(`Already set: ${stats.alreadySet}`);
    console.log(`Missing source timestamps: ${stats.missingSource}`);
    console.log(`Would update: ${stats.wouldUpdate}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(`Failed: ${stats.failed}`);
    if (!commit) console.log('Dry run complete. Use --commit to persist changes.');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Backfill failed:', err.message || err);
  process.exitCode = 1;
});
