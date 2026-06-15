#!/usr/bin/env node
/**
 * Send a one-off guidance 30-min reminder WhatsApp (template name + slottime).
 *
 * Usage:
 *   node scripts/send-guidance-pre30-test.js 9347763131
 *   node scripts/send-guidance-pre30-test.js --mobile=9347763131 --name="Teja" --slottime="3:30 PM TO 4:30 PM"
 *
 * Uses .env + .env.gupshup.local.
 * Real delivery: copy production GUPSHUP_API_KEY + GUPSHUP_SOURCE into .env.gupshup.local and set WA_INTEGRATION_STUB=0.
 * Pass --allow-stub to exercise the code path without hitting Gupshup (no WhatsApp delivered).
 */
const path = require('path');
const fs = require('fs');

// Preserve explicit shell exports so they win over .env.gupshup.local stub placeholders.
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

const { sendGuidancePre30MinReminderWhatsApp, isGupshupConfigured } = require('../services/gupshupService');
const { buildGuidancePre30MinReminderVars } = require('../utils/guidanceBookingWhatsApp');

function parseArgs(argv) {
  const allowStub = argv.includes('--allow-stub');
  const flagMobile = argv.find((a) => a.startsWith('--mobile='));
  const flagName = argv.find((a) => a.startsWith('--name='));
  const flagSlot = argv.find((a) => a.startsWith('--slottime='));
  const positional = argv.find((a) => /^\d{10}$/.test(a.replace(/\D/g, '').slice(-10)));
  const mobile = flagMobile
    ? flagMobile.split('=')[1].replace(/\D/g, '').slice(-10)
    : positional
      ? positional.replace(/\D/g, '').slice(-10)
      : null;
  const name = flagName ? flagName.split('=').slice(1).join('=').trim() : 'Test Student';
  const slottime = flagSlot ? flagSlot.split('=').slice(1).join('=').trim() : '3:30 PM TO 4:30 PM';
  return { mobile, name, slottime, allowStub };
}

async function main() {
  const { mobile, name, slottime, allowStub } = parseArgs(process.argv.slice(2));
  if (!mobile || mobile.length !== 10) {
    console.error('Usage: node scripts/send-guidance-pre30-test.js <10-digit-mobile> [--name=...] [--slottime=...]');
    process.exit(1);
  }

  if (String(process.env.WA_INTEGRATION_STUB || '').trim() === '1') {
    console.error(
      '[error] WA_INTEGRATION_STUB=1 — no real WhatsApp is sent.\n' +
        '  Option A: edit GuideXpert-Backend/.env.gupshup.local — set real GUPSHUP_API_KEY, GUPSHUP_SOURCE, WA_INTEGRATION_STUB=0\n' +
        '  Option B: one-shot from terminal (values from Vercel Production):\n' +
        '    WA_INTEGRATION_STUB=0 GUPSHUP_API_KEY=... GUPSHUP_SOURCE=... node scripts/send-guidance-pre30-test.js 9347763131\n' +
        '  Use --allow-stub to dry-run only (no WhatsApp delivered).'
    );
    if (!allowStub) process.exit(1);
  }
  if (!isGupshupConfigured()) {
    console.error('Gupshup not configured (ENABLE_WHATSAPP, GUPSHUP_API_KEY, GUPSHUP_SOURCE).');
    process.exit(1);
  }
  if (!process.env.GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER) {
    console.error('Missing GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER in env.');
    process.exit(1);
  }

  const vars = buildGuidancePre30MinReminderVars({ studentName: name }, { slotTime: slottime });
  console.log('Sending guidance_pre30min to', mobile, vars);
  const result = await sendGuidancePre30MinReminderWhatsApp(mobile, vars);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err?.response?.data || err);
  process.exit(1);
});
