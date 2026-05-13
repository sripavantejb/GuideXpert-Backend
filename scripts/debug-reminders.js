/**
 * Debug script to check why reminder SMS is not being sent
 * Run: node scripts/debug-reminders.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const {
  getPre4hrCronConfigFromEnv,
  getPre4hrSlotDateBoundsForCron,
  isSlotDateInPre4hrCronWindow
} = require('../utils/pre4hrSchedule');
const {
  getMeetCronConfigFromEnv,
  getMeetSlotDateBoundsForCron,
  get30MinCronConfigFromEnv,
  get30MinSlotDateBoundsForCron
} = require('../utils/waSlotRelativeSchedule');

async function debugReminders() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get current time info
    const now = new Date();
    const pre4hrCfg = getPre4hrCronConfigFromEnv();
    const { slotDateMin, slotDateMax } = getPre4hrSlotDateBoundsForCron(now, pre4hrCfg);

    console.log('=== TIME INFO ===');
    console.log('Current time (UTC):', now.toISOString());
    console.log('Current time (IST):', now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    console.log('pre4hr cron slotDate band (UTC):', slotDateMin.toISOString(), '…', slotDateMax.toISOString());
    console.log('pre4hr cron slotDate band (IST):', slotDateMin.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), '…', slotDateMax.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    console.log('WA_PRE4HR_OFFSET_MS:', pre4hrCfg.offsetMs, 'WA_PRE4HR_CRON_WINDOW_MS:', pre4hrCfg.windowMs);
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

    // Match GET /api/cron/send-reminders (deadline-backward T−4h band)
    console.log('=== CRON JOB QUERY SIMULATION (send-reminders) ===');
    console.log(
      'Query: isRegistered=true, reminderSent!=true, step3Data.slotDate > now AND in [slotDateMin, slotDateMax]\n'
    );

    const usersForReminder = await FormSubmission.find({
      isRegistered: true,
      reminderSent: { $ne: true },
      'step3Data.slotDate': {
        $gt: now,
        $gte: slotDateMin,
        $lte: slotDateMax
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
      
      // Users whose slot is not in the current T−4h cron band (or not in the future)
      const outsidePre4hrBand = allUsersToday.filter((u) => {
        const slotDate = u.step3Data?.slotDate;
        if (!slotDate) return true;
        if (new Date(slotDate) <= now) return true;
        return !isSlotDateInPre4hrCronWindow(slotDate, now, pre4hrCfg);
      });
      console.log(`- Users with slot not in current pre4hr cron band (or past): ${outsidePre4hrBand.length}`);

      if (outsidePre4hrBand.length > 0) {
        console.log('\nSlots not in current pre4hr band (IST):');
        outsidePre4hrBand.forEach((u) => {
          const slotDate = new Date(u.step3Data?.slotDate);
          const hoursUntil = (slotDate - now) / (1000 * 60 * 60);
          console.log(
            `  - ${u.phone}: ${slotDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (${hoursUntil.toFixed(2)} hours from now)`
          );
        });
      }
    }

    // --- meet (T−1h band) ---
    const meetCfg = getMeetCronConfigFromEnv();
    const { slotDateMin: meetMin, slotDateMax: meetMax } = getMeetSlotDateBoundsForCron(now, meetCfg);
    console.log('\n=== CRON QUERY SIMULATION (send-meetlinks) ===');
    console.log('meet band (UTC):', meetMin.toISOString(), '…', meetMax.toISOString());
    console.log('WA_MEET_OFFSET_MS:', meetCfg.offsetMs, 'WA_MEET_CRON_WINDOW_MS:', meetCfg.windowMs);
    const usersForMeet = await FormSubmission.find({
      isRegistered: true,
      meetLinkSent: { $ne: true },
      'step3Data.slotDate': { $gt: now, $gte: meetMin, $lte: meetMax }
    })
      .select('phone fullName step3Data.slotDate step3Data.selectedSlot')
      .lean();
    console.log(`Would find ${usersForMeet.length} users for meet link cron.\n`);

    // --- 30min (T−30m band) ---
    const thirtyCfg = get30MinCronConfigFromEnv();
    const { slotDateMin: tMin, slotDateMax: tMax } = get30MinSlotDateBoundsForCron(now, thirtyCfg);
    console.log('=== CRON QUERY SIMULATION (send-30min-reminders) ===');
    console.log('30min band (UTC):', tMin.toISOString(), '…', tMax.toISOString());
    console.log('WA_30MIN_OFFSET_MS:', thirtyCfg.offsetMs, 'WA_30MIN_CRON_WINDOW_MS:', thirtyCfg.windowMs);
    const usersFor30 = await FormSubmission.find({
      isRegistered: true,
      reminder30MinSent: { $ne: true },
      'step3Data.slotDate': { $gt: now, $gte: tMin, $lte: tMax }
    })
      .select('phone fullName step3Data.slotDate step3Data.selectedSlot')
      .lean();
    console.log(`Would find ${usersFor30.length} users for 30min reminder cron.\n`);

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
