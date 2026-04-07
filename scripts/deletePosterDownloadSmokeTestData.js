/**
 * Remove poster-download rows created by npm run test:poster-track (TrackSmokeTest + 9999999999)
 * and similar curl smoke tests.
 *
 * Usage (from GuideXpert-Backend):
 *   node scripts/deletePosterDownloadSmokeTestData.js --dry-run   # count only
 *   node scripts/deletePosterDownloadSmokeTestData.js             # delete
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const PosterDownload = require('../models/PosterDownload');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();

  const filter = {
    $or: [
      { mobileSnapshot: '9999999999' },
      { displayNameSnapshot: /^TrackSmokeTest$/i },
      {
        displayNameSnapshot: 'T',
        mobileSnapshot: '9999999999',
      },
    ],
  };

  const count = await PosterDownload.countDocuments(filter);
  console.log(`[poster-downloads] Matched ${count} document(s) (smoke / test data).`);

  if (dryRun) {
    console.log('[poster-downloads] Dry run — nothing deleted. Run without --dry-run to delete.');
    await mongoose.connection.close();
    process.exit(0);
    return;
  }

  if (count === 0) {
    await mongoose.connection.close();
    process.exit(0);
    return;
  }

  const res = await PosterDownload.deleteMany(filter);
  console.log(`[poster-downloads] Deleted ${res.deletedCount} document(s).`);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[poster-downloads]', err);
  process.exit(1);
});
