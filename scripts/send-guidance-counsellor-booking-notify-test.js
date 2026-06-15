#!/usr/bin/env node
/**
 * Send a one-off guidance counsellor booking notify WhatsApp (name, date, time, counsellor).
 *
 * Usage:
 *   node scripts/send-guidance-counsellor-booking-notify-test.js 9599697281
 *   node scripts/send-guidance-counsellor-booking-notify-test.js --mobile=9599697281 --name="Rahul" --date="15 Jun 2026" --time="3:30 PM TO 4:30 PM" --counsellor="V Divya"
 *
 * Uses .env + .env.gupshup.local.
 * Real delivery: copy production GUPSHUP_API_KEY + GUPSHUP_SOURCE into .env.gupshup.local and set WA_INTEGRATION_STUB=0.
 * Pass --allow-stub to exercise the code path without hitting Gupshup.
 */
const path = require('path');
const fs = require('fs');

const shellEnv = {
  WA_INTEGRATION_STUB: process.env.WA_INTEGRATION_STUB,
  GUPSHUP_API_KEY: process.env.GUPSHUP_API_KEY,
  GUPSHUP_SOURCE: process.env.GUPSHUP_SOURCE,
};

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const gupshupLocal = path.join(__dirname, '../.env.gupshup.local');
if (fs.existsSync(gupshupLocal)) {
  require('dotenv').config({ path: gupshupLocal, override: true });
}
for (const [key, value] of Object.entries(shellEnv)) {
  if (value !== undefined) process.env[key] = value;
}

const {
  sendGuidanceCounsellorBookingNotifyWhatsApp,
  isGupshupConfigured,
} = require('../services/gupshupService');
const { buildGuidanceCounsellorBookingNotifyVars } = require('../utils/guidanceBookingWhatsApp');

function parseArgs(argv) {
  const allowStub = argv.includes('--allow-stub');
  const flagMobile = argv.find((a) => a.startsWith('--mobile='));
  const flagName = argv.find((a) => a.startsWith('--name='));
  const flagDate = argv.find((a) => a.startsWith('--date='));
  const flagTime = argv.find((a) => a.startsWith('--time='));
  const flagCounsellor = argv.find((a) => a.startsWith('--counsellor='));
  const positional = argv.find((a) => /^\d{10}$/.test(a.replace(/\D/g, '').slice(-10)));
  const mobile = flagMobile
    ? flagMobile.split('=')[1].replace(/\D/g, '').slice(-10)
    : positional
      ? positional.replace(/\D/g, '').slice(-10)
      : null;
  const name = flagName ? flagName.split('=').slice(1).join('=').trim() : 'Test Student';
  const date = flagDate ? flagDate.split('=').slice(1).join('=').trim() : '15 Jun 2026';
  const time = flagTime ? flagTime.split('=').slice(1).join('=').trim() : '3:30 PM TO 4:30 PM';
  const counsellor = flagCounsellor
    ? flagCounsellor.split('=').slice(1).join('=').trim()
    : 'V Divya';
  return { mobile, name, date, time, counsellor, allowStub };
}

async function main() {
  const { mobile, name, date, time, counsellor, allowStub } = parseArgs(process.argv.slice(2));
  if (!mobile || mobile.length !== 10) {
    console.error(
      'Usage: node scripts/send-guidance-counsellor-booking-notify-test.js <10-digit-mobile> [--name=...] [--date=...] [--time=...] [--counsellor=...]'
    );
    process.exit(1);
  }

  if (String(process.env.WA_INTEGRATION_STUB || '').trim() === '1' && !allowStub) {
    console.error(
      '[error] WA_INTEGRATION_STUB=1 — no real WhatsApp is sent.\n' +
        'Copy production GUPSHUP_API_KEY + GUPSHUP_SOURCE into .env.gupshup.local, set WA_INTEGRATION_STUB=0, then re-run. Use --allow-stub to dry-run only.'
    );
    process.exit(1);
  }

  if (!isGupshupConfigured()) {
    console.error('[error] Gupshup not configured (ENABLE_WHATSAPP, GUPSHUP_API_KEY, GUPSHUP_SOURCE).');
    process.exit(1);
  }

  const vars = buildGuidanceCounsellorBookingNotifyVars(
    { studentName: name },
    { slotDate: '2026-06-15', slotTime: time },
    { name: counsellor }
  );
  if (date) vars.date = date;

  console.log('Sending guidance_counsellor_booking_notify to', mobile, vars);
  const result = await sendGuidanceCounsellorBookingNotifyWhatsApp(mobile, vars);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
