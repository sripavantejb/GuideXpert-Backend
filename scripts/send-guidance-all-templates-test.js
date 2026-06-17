#!/usr/bin/env node
/**
 * Send all three guidance WhatsApp templates to one mobile (smoke test).
 *
 * Usage:
 *   node scripts/send-guidance-all-templates-test.js 9347763131
 *   node scripts/send-guidance-all-templates-test.js --mobile=9347763131 --name="Test User"
 *
 * Requires real Gupshup in .env.gupshup.local (WA_INTEGRATION_STUB=0).
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
  isGupshupConfigured,
  sendGuidanceBookingSubmitWhatsApp,
  sendGuidancePre30MinReminderWhatsApp,
  sendGuidanceCounsellorBookingNotifyWhatsApp,
} = require('../services/gupshupService');
const {
  buildGuidanceBookingSubmitVars,
  buildGuidancePre30MinReminderVars,
  buildGuidanceCounsellorBookingNotifyVars,
} = require('../utils/guidanceBookingWhatsApp');

function parseArgs(argv) {
  const allowStub = argv.includes('--allow-stub');
  const flagMobile = argv.find((a) => a.startsWith('--mobile='));
  const flagName = argv.find((a) => a.startsWith('--name='));
  const positional = argv.find((a) => /^\d{10}$/.test(a.replace(/\D/g, '').slice(-10)));
  const mobile = flagMobile
    ? flagMobile.split('=')[1].replace(/\D/g, '').slice(-10)
    : positional
      ? positional.replace(/\D/g, '').slice(-10)
      : null;
  const name = flagName ? flagName.split('=').slice(1).join('=').trim() : 'Test Student';
  return { mobile, name, allowStub };
}

async function sendOne(label, fn) {
  console.log(`\n--- ${label} ---`);
  const result = await fn();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const { mobile, name, allowStub } = parseArgs(process.argv.slice(2));
  if (!mobile || mobile.length !== 10) {
    console.error('Usage: node scripts/send-guidance-all-templates-test.js <10-digit-mobile>');
    process.exit(1);
  }

  if (String(process.env.WA_INTEGRATION_STUB || '').trim() === '1' && !allowStub) {
    console.error(
      '[error] WA_INTEGRATION_STUB=1 — no real WhatsApp is sent.\n' +
        'Set production GUPSHUP_API_KEY + GUPSHUP_SOURCE in .env.gupshup.local with WA_INTEGRATION_STUB=0, or pass --allow-stub.'
    );
    process.exit(1);
  }
  if (!isGupshupConfigured()) {
    console.error('[error] Gupshup not configured.');
    process.exit(1);
  }

  const slot = {
    slotDate: '2026-06-17',
    slotTime: '3:30 PM TO 4:30 PM',
  };
  const counselor = { name: 'V Divya' };

  const results = [];
  results.push(
    await sendOne('guidance_booking_submit', () =>
      sendGuidanceBookingSubmitWhatsApp(mobile, buildGuidanceBookingSubmitVars(slot))
    )
  );
  results.push(
    await sendOne('guidance_pre30min', () =>
      sendGuidancePre30MinReminderWhatsApp(
        mobile,
        buildGuidancePre30MinReminderVars({ studentName: name }, slot)
      )
    )
  );
  results.push(
    await sendOne('guidance_counsellor_booking_notify', () =>
      sendGuidanceCounsellorBookingNotifyWhatsApp(
        mobile,
        buildGuidanceCounsellorBookingNotifyVars({ studentName: name }, slot, counselor)
      )
    )
  );

  const ok = results.every((r) => r && r.success);
  console.log(ok ? '\nAll three templates submitted successfully.' : '\nOne or more sends failed.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err?.response?.data || err);
  process.exit(1);
});
