#!/usr/bin/env node
/**
 * One-off: map legacy section1Data.classStatus radio values to the current enum
 * on iitCounsellingSubmissions. Run after deploying the new schema/allow-list.
 *
 *   node scripts/migrateIitCounsellingClassStatusValues.js
 *   node scripts/migrateIitCounsellingClassStatusValues.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');

const LEGACY_TO_NEW = {
  '12th Appearing': 'Studying 12th/Intermediate 2nd Year',
  '12th Passed': 'Completed 12th/Intermediate 2nd Year',
};

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function run() {
  const dryRun = hasFlag('--dry-run');
  await connectDB();
  console.log('[migrate-iit-class-status] Connected DB:', mongoose.connection.name);

  let total = 0;
  for (const [from, to] of Object.entries(LEGACY_TO_NEW)) {
    const filter = { 'iitCounselling.section1Data.classStatus': from };
    const count = await IitCounsellingSubmission.countDocuments(filter);
    console.log(`[migrate-iit-class-status] ${from} -> ${to}: ${count} document(s)`);
    total += count;
    if (!dryRun && count > 0) {
      const res = await IitCounsellingSubmission.updateMany(filter, {
        $set: { 'iitCounselling.section1Data.classStatus': to },
      });
      console.log(`[migrate-iit-class-status]   matched: ${res.matchedCount}, modified: ${res.modifiedCount}`);
    }
  }

  if (dryRun) {
    console.log('[migrate-iit-class-status] DRY RUN — no writes. Total matching:', total);
  } else {
    console.log('[migrate-iit-class-status] Done. Total legacy values seen:', total);
  }
}

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrate-iit-class-status] Failed:', err);
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore
    }
    process.exit(1);
  });
