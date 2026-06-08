#!/usr/bin/env node
/**
 * One-off OSVI /callback test. Usage:
 *   node scripts/testOsviCallbackNow.js [phone10] [personName]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { buildOsviPayloadFromTestCall } = require('../utils/aiCallReminderPayload');
const { scheduleOsviCallback } = require('../utils/osviService');

const phone10 = (process.argv[2] || '8919926373').replace(/\D/g, '').slice(-10);
const personName = process.argv[3] || 'tej';
const callbackTime = new Date(Date.now() + 90 * 1000);

const payload = buildOsviPayloadFromTestCall({
  personName,
  phone: phone10,
  callbackTime,
  notes: 'GuideXpert admin test call',
});

async function main() {
  console.log('Payload:', JSON.stringify(payload, null, 2));
  const result = await scheduleOsviCallback(payload);
  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
