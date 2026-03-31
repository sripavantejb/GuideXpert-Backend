/**
 * Insert a TrainingAttendance row (same as POST /api/training/register after training meet OTP).
 *
 * Usage (from GuideXpert-Backend):
 *   node scripts/seedTrainingMeetingAttendance.js [10-digit-phone] [full name]
 *
 * Defaults: 9959501225, Bora Gowri
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const TrainingAttendance = require('../models/TrainingAttendance');
const otpRepository = require('../utils/otpRepository');

async function main() {
  const phone = otpRepository.normalize(process.argv[2] || '9959501225');
  const rawName = (process.argv[3] || 'Bora Gowri').trim();

  if (!phone || phone.length !== 10) {
    console.error('Valid 10-digit phone required.');
    process.exit(1);
  }
  if (rawName.length < 2 || rawName.length > 100) {
    console.error('Name must be 2–100 characters.');
    process.exit(1);
  }

  await connectDB();

  const record = await TrainingAttendance.create({
    name: rawName,
    mobileNumber: phone,
    attendanceStatus: 'joined'
  });

  console.log('OK — TrainingAttendance created');
  console.log('  id:', record._id.toString());
  console.log('  name:', record.name);
  console.log('  mobileNumber:', record.mobileNumber);
  console.log('  timestamp:', record.timestamp.toISOString());

  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
