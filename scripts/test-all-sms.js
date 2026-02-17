/**
 * Test all SMS types by sending to a specific phone number
 * Run: node scripts/test-all-sms.js <phone_number>
 * Example: node scripts/test-all-sms.js 9347763131
 */

require('dotenv').config();
const {
  sendSlotConfirmationSms,
  sendReminderSms,
  sendMeetLinkSms,
  sendReminder30MinSms
} = require('../utils/msg91Service');

async function testAllSms(phone) {
  console.log('=== TESTING ALL SMS TYPES ===\n');
  console.log('Target phone:', phone);
  console.log('');

  const meetingLink = process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo';

  // Test 1: Slot Confirmation SMS
  console.log('--- Test 1: Slot Confirmation SMS ---');
  console.log('Template ID:', process.env.MSG91_SLOT_CONFIRMATION_TEMPLATE_ID);
  const test1 = await sendSlotConfirmationSms(phone, {
    name: 'Test User',
    date: '3rd Feb 2026',
    time: '7:00 PM'
  });
  console.log('Result:', test1);
  console.log('');

  // Wait 2 seconds between SMS
  await new Promise(r => setTimeout(r, 2000));

  // Test 2: Reminder SMS (4 hours before)
  console.log('--- Test 2: Reminder SMS (4hr before) ---');
  console.log('Template ID:', process.env.MSG91_REMINDER_TEMPLATE_ID);
  const test2 = await sendReminderSms(phone, {});
  console.log('Result:', test2);
  console.log('');

  await new Promise(r => setTimeout(r, 2000));

  // Test 3: Meet Link SMS (1 hour before)
  console.log('--- Test 3: Meet Link SMS (1hr before) ---');
  console.log('Template ID:', process.env.MSG91_MEETLINK_TEMPLATE_ID);
  console.log('Meeting Link:', meetingLink);
  const test3 = await sendMeetLinkSms(phone, { var: meetingLink });
  console.log('Result:', test3);
  console.log('');

  await new Promise(r => setTimeout(r, 2000));

  // Test 4: 30-Min Live Reminder SMS
  console.log('--- Test 4: 30-Min Live Reminder SMS ---');
  console.log('Template ID:', process.env.MSG91_30MIN_REMINDER_TEMPLATE_ID);
  console.log('Meeting Link:', meetingLink);
  const test4 = await sendReminder30MinSms(phone, { var: meetingLink });
  console.log('Result:', test4);
  console.log('');

  // Summary
  console.log('=== SUMMARY ===');
  console.log('1. Slot Confirmation:', test1.success ? '✓ Sent' : '✗ Failed - ' + test1.error);
  console.log('2. Reminder (4hr):', test2.success ? '✓ Sent' : '✗ Failed - ' + test2.error);
  console.log('3. Meet Link (1hr):', test3.success ? '✓ Sent' : '✗ Failed - ' + test3.error);
  console.log('4. 30-Min Reminder:', test4.success ? '✓ Sent' : '✗ Failed - ' + test4.error);
  console.log('');
  console.log('Check your phone for SMS messages!');
}

const phone = process.argv[2];
if (!phone) {
  console.error('Usage: node scripts/test-all-sms.js <phone_number>');
  console.error('Example: node scripts/test-all-sms.js 9347763131');
  process.exit(1);
}

testAllSms(phone);
