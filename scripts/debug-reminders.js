/**
 * Debug script to check why reminder SMS is not being sent
 * Run: node scripts/debug-reminders.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');

async function debugReminders() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get current time info
    const now = new Date();
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    
    console.log('=== TIME INFO ===');
    console.log('Current time (UTC):', now.toISOString());
    console.log('Current time (IST):', now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    console.log('4 hours from now (UTC):', fourHoursFromNow.toISOString());
    console.log('4 hours from now (IST):', fourHoursFromNow.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    console.log('');

    // Get today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    console.log('=== TODAY\'S REGISTERED USERS ===');
    
    // Find ALL users with slots today (regardless of status)
    const allUsersToday = await FormSubmission.find({
      'step3Data.slotDate': { $gte: startOfDay, $lte: endOfDay }
    }).select('phone fullName isRegistered reminderSent meetLinkSent reminder30MinSent step3Data createdAt').lean();

    console.log(`Found ${allUsersToday.length} users with slots today:\n`);

    allUsersToday.forEach((user, i) => {
      const slotDate = user.step3Data?.slotDate;
      const slotDateIST = slotDate ? new Date(slotDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';
      
      console.log(`--- User ${i + 1} ---`);
      console.log('Phone:', user.phone);
      console.log('Name:', user.fullName || user.step1Data?.fullName || 'N/A');
      console.log('isRegistered:', user.isRegistered);
      console.log('Slot Date (UTC):', slotDate ? new Date(slotDate).toISOString() : 'N/A');
      console.log('Slot Date (IST):', slotDateIST);
      console.log('Selected Slot:', user.step3Data?.selectedSlot || 'N/A');
      console.log('reminderSent:', user.reminderSent);
      console.log('meetLinkSent:', user.meetLinkSent);
      console.log('reminder30MinSent:', user.reminder30MinSent);
      console.log('');
    });

    // Check what the cron job query would find
    console.log('=== CRON JOB QUERY SIMULATION ===');
    console.log('Query: isRegistered=true, reminderSent!=true, slotDate between now and 4 hours from now\n');

    const usersForReminder = await FormSubmission.find({
      isRegistered: true,
      reminderSent: { $ne: true },
      'step3Data.slotDate': {
        $gte: now,
        $lte: fourHoursFromNow
      }
    }).select('phone fullName step3Data.slotDate step3Data.selectedSlot').lean();

    console.log(`Cron would find ${usersForReminder.length} users to send reminders:\n`);
    
    usersForReminder.forEach((user, i) => {
      console.log(`${i + 1}. ${user.phone} - Slot: ${new Date(user.step3Data?.slotDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    });

    if (usersForReminder.length === 0) {
      console.log('\n=== WHY NO USERS FOUND? ===');
      
      // Check users who have isRegistered = false
      const notRegistered = allUsersToday.filter(u => !u.isRegistered);
      console.log(`- Users with isRegistered=false: ${notRegistered.length}`);
      
      // Check users who already got reminder
      const alreadySent = allUsersToday.filter(u => u.reminderSent === true);
      console.log(`- Users with reminderSent=true: ${alreadySent.length}`);
      
      // Check users with slot outside the 4-hour window
      const outsideWindow = allUsersToday.filter(u => {
        const slotDate = new Date(u.step3Data?.slotDate);
        return slotDate < now || slotDate > fourHoursFromNow;
      });
      console.log(`- Users with slot outside 4-hour window: ${outsideWindow.length}`);
      
      // Show slot times for users outside window
      if (outsideWindow.length > 0) {
        console.log('\nSlot times outside window:');
        outsideWindow.forEach(u => {
          const slotDate = new Date(u.step3Data?.slotDate);
          const hoursUntil = (slotDate - now) / (1000 * 60 * 60);
          console.log(`  - ${u.phone}: ${slotDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (${hoursUntil.toFixed(2)} hours from now)`);
        });
      }
    }

    console.log('\n=== ENV VARIABLES CHECK ===');
    console.log('MSG91_AUTH_KEY:', process.env.MSG91_AUTH_KEY ? '✓ Set' : '✗ Missing');
    console.log('MSG91_REMINDER_TEMPLATE_ID:', process.env.MSG91_REMINDER_TEMPLATE_ID ? '✓ Set' : '✗ Missing');
    console.log('MSG91_MEETLINK_TEMPLATE_ID:', process.env.MSG91_MEETLINK_TEMPLATE_ID ? '✓ Set' : '✗ Missing');
    console.log('MSG91_30MIN_REMINDER_TEMPLATE_ID:', process.env.MSG91_30MIN_REMINDER_TEMPLATE_ID ? '✓ Set' : '✗ Missing');
    console.log('DEMO_MEETING_LINK:', process.env.DEMO_MEETING_LINK ? '✓ Set' : '✗ Missing');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

debugReminders();
