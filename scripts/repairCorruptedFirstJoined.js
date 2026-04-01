require('dotenv').config();
const mongoose = require('mongoose');
const WebinarProgress = require('../models/WebinarProgress');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return { commit: args.has('--commit') };
}

const FIVE_MINUTES = 5 * 60 * 1000;

async function run() {
  const { commit } = parseArgs(process.argv);
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing in environment');

  const stats = {
    mode,
    scanned: 0,
    genuine: 0,
    corrupted: 0,
    noFirstJoined: 0,
    repaired: 0,
  };

  try {
    console.log(`[${mode}] Connecting...`);
    await mongoose.connect(uri);

    const docs = await WebinarProgress.find(
      {},
      { _id: 1, phone: 1, firstJoinedAt: 1, createdAt: 1, isLegacyUser: 1 }
    ).lean();
    stats.scanned = docs.length;

    for (const doc of docs) {
      if (!doc.firstJoinedAt) {
        stats.noFirstJoined += 1;
        continue;
      }

      if (!doc.createdAt) {
        stats.genuine += 1;
        continue;
      }

      const diffMs = Math.abs(
        new Date(doc.firstJoinedAt).getTime() - new Date(doc.createdAt).getTime()
      );

      if (diffMs <= FIVE_MINUTES) {
        stats.genuine += 1;
        continue;
      }

      stats.corrupted += 1;
      console.log(
        `  CORRUPTED: phone=${doc.phone}  createdAt=${new Date(doc.createdAt).toISOString()}  firstJoinedAt=${new Date(doc.firstJoinedAt).toISOString()}  diff=${Math.round(diffMs / 60000)}min`
      );

      if (!commit) continue;

      const result = await WebinarProgress.updateOne(
        { _id: doc._id },
        { $set: { firstJoinedAt: null, isLegacyUser: true } }
      );
      if (result.modifiedCount > 0) stats.repaired += 1;
    }

    console.log('\n===== Repair corrupted firstJoinedAt =====');
    console.log(`Mode: ${stats.mode}`);
    console.log(`Scanned: ${stats.scanned}`);
    console.log(`No firstJoinedAt (already null): ${stats.noFirstJoined}`);
    console.log(`Genuine (diff <= 5 min): ${stats.genuine}`);
    console.log(`Corrupted (diff > 5 min): ${stats.corrupted}`);
    console.log(`Repaired: ${stats.repaired}`);
    if (!commit) console.log('Dry run complete. Use --commit to persist changes.');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Repair failed:', err.message || err);
  process.exitCode = 1;
});
