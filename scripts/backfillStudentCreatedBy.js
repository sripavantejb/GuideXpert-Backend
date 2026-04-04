/**
 * One-time backfill: set createdBy = counsellorId for Student documents missing createdBy.
 * Run from backend directory: node scripts/backfillStudentCreatedBy.js
 * Requires MONGODB_URI (or local default) and loads ../.env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const connectDB = require('../config/db');
const Student = require('../models/Student');

async function main() {
  try {
    await connectDB();

    const filter = {
      $or: [{ createdBy: null }, { createdBy: { $exists: false } }],
    };

    const before = await Student.countDocuments(filter);
    console.log(`[backfillStudentCreatedBy] Documents missing createdBy: ${before}`);

    if (before === 0) {
      console.log('[backfillStudentCreatedBy] Nothing to do.');
      process.exit(0);
      return;
    }

    // MongoDB 4.2+ pipeline update: copy counsellorId into createdBy
    const result = await Student.updateMany(filter, [
      { $set: { createdBy: '$counsellorId' } },
    ]);

    console.log('[backfillStudentCreatedBy] updateMany result:', {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
    process.exit(0);
  } catch (err) {
    console.error('[backfillStudentCreatedBy]', err);
    process.exit(1);
  }
}

main();
