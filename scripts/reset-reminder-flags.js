/**
 * Reset reminder SMS flags for today's 7 PM slot users
 * This allows the cron job to send reminders again for testing
 * Run: node scripts/reset-reminder-flags.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');

async function resetReminderFlags() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Find users with 7 PM IST slot today (13:30 UTC)
    const targetSlotDate = new Date('2026-02-03T13:30:00.000Z');
    
    // Get count before reset
    const beforeCount = await FormSubmission.countDocuments({
      'step3Data.slotDate': targetSlotDate,
      reminderSent: true
    });
    
    console.log(`Found ${beforeCount} users with reminderSent=true for 7 PM slot\n`);

    // Reset the flags
    const result = await FormSubmission.updateMany(
      {
        'step3Data.slotDate': targetSlotDate
      },
      {
        $set: {
          reminderSent: false,
          reminderSentAt: null
        }
      }
    );

    console.log('Reset result:', result);
    console.log(`\nReset ${result.modifiedCount} users' reminderSent flag to false`);
    console.log('\nThe next cron run should now pick up these users and send reminder SMS.');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

resetReminderFlags();
