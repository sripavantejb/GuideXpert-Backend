require('dotenv').config();
const mongoose = require('mongoose');
const WebinarProgress = require('../models/WebinarProgress');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return { commit: args.has('--commit') };
}

async function run() {
  const { commit } = parseArgs(process.argv);
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing in environment');

  const stats = {
    mode,
    scanned: 0,
    legacyDocs: 0,
    trackedDocs: 0,
    wouldUpdateLegacy: 0,
    wouldUpdateTracked: 0,
    updatedLegacy: 0,
    updatedTracked: 0,
  };

  try {
    console.log(`[${mode}] Connecting...`);
    await mongoose.connect(uri);

    const docs = await WebinarProgress.find({}, { _id: 1, firstJoinedAt: 1, isLegacyUser: 1 }).lean();
    stats.scanned = docs.length;

    for (const doc of docs) {
      const shouldBeLegacy = !doc.firstJoinedAt;
      if (shouldBeLegacy) stats.legacyDocs += 1;
      else stats.trackedDocs += 1;

      if (doc.isLegacyUser === shouldBeLegacy) continue;

      if (shouldBeLegacy) stats.wouldUpdateLegacy += 1;
      else stats.wouldUpdateTracked += 1;

      if (!commit) continue;

      const result = await WebinarProgress.updateOne(
        { _id: doc._id },
        { $set: { isLegacyUser: shouldBeLegacy } }
      );
      if (result.modifiedCount > 0) {
        if (shouldBeLegacy) stats.updatedLegacy += 1;
        else stats.updatedTracked += 1;
      }
    }

    console.log('\n===== Webinar legacy classifier =====');
    console.log(`Mode: ${stats.mode}`);
    console.log(`Scanned: ${stats.scanned}`);
    console.log(`Legacy docs (firstJoinedAt missing): ${stats.legacyDocs}`);
    console.log(`Tracked docs (firstJoinedAt present): ${stats.trackedDocs}`);
    console.log(`Would update -> legacy=true: ${stats.wouldUpdateLegacy}`);
    console.log(`Would update -> legacy=false: ${stats.wouldUpdateTracked}`);
    console.log(`Updated -> legacy=true: ${stats.updatedLegacy}`);
    console.log(`Updated -> legacy=false: ${stats.updatedTracked}`);
    if (!commit) console.log('Dry run complete. Use --commit to persist changes.');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Legacy classifier failed:', err.message || err);
  process.exitCode = 1;
});
