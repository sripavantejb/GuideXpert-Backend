/**
 * Set TrainingAttendance timestamp(s) to "yesterday" for a phone (optional name match).
 *
 * Usage (from GuideXpert-Backend):
 *   node scripts/setTrainingAttendanceYesterday.js [phone] [name-substring]
 *
 * Example:
 *   node scripts/setTrainingAttendanceYesterday.js 9959501225 "Bora Gowri"
 *
 * "Yesterday" = previous calendar day in Asia/Kolkata, join time 15:30 IST.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const TrainingAttendance = require('../models/TrainingAttendance');
const otpRepository = require('../utils/otpRepository');

function yesterdayJoinTimeIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const y = +parts.find((p) => p.type === 'year').value;
  const mo = +parts.find((p) => p.type === 'month').value;
  const da = +parts.find((p) => p.type === 'day').value;
  const todayMidnightIST = new Date(
    `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}T00:00:00+05:30`
  );
  const yesterdayMidnightIST = new Date(todayMidnightIST.getTime() - 24 * 60 * 60 * 1000);
  return new Date(yesterdayMidnightIST.getTime() + 15 * 60 * 60 * 1000 + 30 * 60 * 1000);
}

async function main() {
  const phone = otpRepository.normalize(process.argv[2] || '9959501225');
  const nameHint = (process.argv[3] || '').trim();

  if (!phone || phone.length !== 10) {
    console.error('Valid 10-digit phone required.');
    process.exit(1);
  }

  const joinedAt = yesterdayJoinTimeIST();

  await connectDB();

  const query = { mobileNumber: phone };
  if (nameHint.length >= 2) {
    query.name = new RegExp(`^\\s*${nameHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  }

  const result = await TrainingAttendance.updateMany(query, {
    $set: {
      timestamp: joinedAt,
      createdAt: joinedAt,
      updatedAt: joinedAt
    }
  });

  if (result.matchedCount === 0) {
    console.log('No TrainingAttendance matched. Query:', JSON.stringify(query));
    await mongoose.connection.close();
    process.exit(1);
  }

  console.log('OK — updated', result.modifiedCount, 'of', result.matchedCount, 'row(s)');
  console.log('  phone:', phone);
  console.log('  join timestamp (ISO):', joinedAt.toISOString());
  console.log('  IST display:', joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }));

  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
