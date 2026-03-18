/**
 * One-time script: Update a TrainingFeedback (activation form) record:
 * - Find by old mobile: +91 91 82248 803 (normalized to 10 digits: 9182248803)
 * - Set name to "Neeraja", mobileNumber and whatsappNumber to 7989565121
 *
 * Run from backend directory: node scripts/update-activation-mobile-and-name.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TrainingFeedback = require('../models/TrainingFeedback');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(-10);
}

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.\n');

    const oldRaw = '+91 91 82248 803';
    const old10 = to10Digits(oldRaw);
    const newMobile = '7989565121';
    const newName = 'Neeraja';

    const filter = {
      $or: [
        { mobileNumber: old10 },
        { whatsappNumber: old10 },
        { mobileNumber: oldRaw.replace(/\D/g, '').trim() },
        { whatsappNumber: oldRaw.replace(/\D/g, '').trim() }
      ]
    };

    const doc = await TrainingFeedback.findOne(filter);
    if (!doc) {
      console.log(`No TrainingFeedback found with mobile/whatsapp matching "${oldRaw}" (10-digit: ${old10}).`);
      return;
    }

    console.log('Found record:', { name: doc.name, mobileNumber: doc.mobileNumber, whatsappNumber: doc.whatsappNumber });
    doc.name = newName;
    doc.mobileNumber = newMobile;
    doc.whatsappNumber = newMobile;
    await doc.save();
    console.log('\nUpdated to:', { name: doc.name, mobileNumber: doc.mobileNumber, whatsappNumber: doc.whatsappNumber });
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

run();
