/**
 * One-time script: Remove form submission entries where the user selected SUNDAY_3PM slot.
 * Run from backend directory: node scripts/remove-sunday-3pm-entries.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');

async function removeSunday3PmEntries() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const filter = {
      $or: [
        { 'step3Data.selectedSlot': 'SUNDAY_3PM' },
        { selectedSlot: 'SUNDAY_3PM' }
      ]
    };

    const count = await FormSubmission.countDocuments(filter);
    console.log(`Found ${count} submission(s) with Sunday 3 PM slot.\n`);

    if (count === 0) {
      console.log('Nothing to remove. Exiting.');
      return;
    }

    const result = await FormSubmission.deleteMany(filter);
    console.log(`Removed ${result.deletedCount} submission(s) where SUNDAY_3PM was selected.`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

removeSunday3PmEntries();
