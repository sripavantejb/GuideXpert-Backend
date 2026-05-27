/**
 * Read-only health report for IIT Gupshup WhatsApp + MSG91 Telugu SMS automations.
 *
 * Usage: npm run verify:iit-messaging
 * Requires MONGODB_URI (and optional production .env for cron ping).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { isGupshupConfigured, isWhatsAppEnabled } = require('../services/gupshupService');
const { getCronScheduleHealth } = require('../utils/waCronScheduleHealth');
const { getCronSecretForOutboundPing } = require('../utils/cronSecret');
const { IIT_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');

const GUPSHUP_IIT_ENV_KEYS = [
  'ENABLE_WHATSAPP',
  'GUPSHUP_API_KEY',
  'GUPSHUP_SOURCE',
  'GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL',
  'GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU',
  'GUPSHUP_TEMPLATE_IIT_PRE2HR_HINDI',
  'GUPSHUP_TEMPLATE_IIT_PRE45MIN_TELUGU',
  'GUPSHUP_TEMPLATE_IIT_PRE45MIN_HINDI',
  'GUPSHUP_TEMPLATE_IIT_PRE15MIN_TELUGU',
  'GUPSHUP_TEMPLATE_IIT_PRE15MIN_HINDI',
  'GUPSHUP_IIT_PRE2HR_PARAM_PROFILES',
  'GUPSHUP_IIT_PRE2HR_HEADER_IMAGE_URL',
];

const MSG91_IIT_ENV_KEYS = [
  'MSG91_AUTH_KEY',
  'IIT_COUNSELLING_MEET_LINK',
  'MSG91_IIT_TELUGU_SMS_TMINUS_1D_TEMPLATE_ID',
  'MSG91_IIT_TELUGU_SMS_TMINUS_2H_TEMPLATE_ID',
  'MSG91_IIT_TELUGU_SMS_SESSION_8AM_TEMPLATE_ID',
  'MSG91_IIT_TELUGU_SMS_TMINUS_30M_TEMPLATE_ID',
  'MSG91_IIT_TELUGU_SMS_TMINUS_5M_TEMPLATE_ID',
  'MSG91_IIT_TELUGU_SMS_TPLUS_5M_TEMPLATE_ID',
];

function envStatus(key) {
  const v = process.env[key];
  if (v == null || String(v).trim() === '') return 'MISSING';
  if (/^your_|_here$/i.test(String(v))) return 'PLACEHOLDER';
  return 'SET';
}

function printEnvSection(title, keys) {
  console.log(`\n=== ${title} ===`);
  for (const k of keys) {
    console.log(`  ${k}: ${envStatus(k)}`);
  }
  console.log(`  Gupshup configured: ${isGupshupConfigured()}`);
  console.log(`  WhatsApp enabled: ${isWhatsAppEnabled()}`);
  console.log(`  Cron secret configured: ${!!getCronSecretForOutboundPing()}`);
}

async function mongoHealth(now) {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const waPre2hr132012 = await WhatsAppMessageEvent.countDocuments({
    messageKind: 'iit_pre2hr',
    status: 'failed',
    webhookErrorCode: '132012',
    createdAt: { $gte: since24h },
  });

  const waByState = await WhatsAppReminderJob.aggregate([
    { $match: { messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS } } },
    { $group: { _id: '$state', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const waDue = await WhatsAppReminderJob.countDocuments({
    messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
    state: 'pending',
    scheduledSendAt: { $lte: now },
  });

  const smsByState = await IitTeluguSmsReminderJob.aggregate([
    { $group: { _id: '$state', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const smsDue = await IitTeluguSmsReminderJob.countDocuments({
    state: 'pending',
    scheduledSendAt: { $lte: now },
  });

  const smsDispatched24h = await IitTeluguSmsReminderJob.countDocuments({
    state: 'dispatched',
    dispatchedAt: { $gte: since24h },
  });

  console.log('\n=== MongoDB (IIT WhatsApp) ===');
  console.log('  Job states:', waByState);
  console.log('  Pending due now:', waDue);
  console.log('  pre2hr 132012 failures (24h):', waPre2hr132012);

  console.log('\n=== MongoDB (IIT Telugu SMS) ===');
  console.log('  Job states:', smsByState);
  console.log('  Pending due now:', smsDue);
  console.log('  Dispatched (24h):', smsDispatched24h);
}

async function pingCron(path, label) {
  const secret = getCronSecretForOutboundPing();
  const base =
    process.env.BACKEND_PUBLIC_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    'https://guide-xpert-backend.vercel.app';
  if (!secret) {
    console.log(`\n=== Cron ping ${label} === SKIPPED (no cron secret in .env)`);
    return;
  }
  const url = `${base.replace(/\/$/, '')}${path}?key=${encodeURIComponent(secret)}`;
  console.log(`\n=== Cron ping ${label} ===`);
  console.log(`  URL: ${path}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    const body = await res.json();
    console.log(`  HTTP ${res.status}`);
    console.log(`  scheduler: ${body?.stats?.scheduler || body?.message || '(see response)'}`);
    if (body?.stats) {
      console.log(
        `  claimed: ${body.stats.jobsClaimed} dispatched: ${body.stats.jobsDispatched} skipped: ${body.stats.jobsSkipped}`
      );
    }
    if (!res.ok) console.log('  body:', JSON.stringify(body).slice(0, 300));
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

async function main() {
  const now = new Date();
  console.log('IIT messaging automation verification');
  console.log('Time:', now.toISOString());

  printEnvSection('Gupshup / WhatsApp env', GUPSHUP_IIT_ENV_KEYS);
  printEnvSection('MSG91 Telugu SMS env', MSG91_IIT_ENV_KEYS);

  if (!process.env.MONGODB_URI) {
    console.error('\nMONGODB_URI missing — skipping DB and cron health.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const uri = mongoose.connection.host;
  console.log('\nMongo host:', uri);

  const cronHealth = await getCronScheduleHealth();
  console.log('\n=== Cron schedule health (MessagingCronRun) ===');
  console.log('  healthy:', cronHealth.healthy);
  for (const j of cronHealth.jobs) {
    const ageMin = j.ageMs != null ? Math.round(j.ageMs / 60000) : null;
    console.log(
      `  ${j.label}: stale=${j.stale} lastSuccess=${j.lastSuccessAt || 'never'} ageMin=${ageMin}`
    );
  }
  if (cronHealth.warnings.length) {
    console.log('  warnings:');
    cronHealth.warnings.forEach((w) => console.log(`    - ${w}`));
  }

  await mongoHealth(now);

  const pingCronFlag = process.argv.includes('--ping-cron');
  if (pingCronFlag) {
    await pingCron('/api/cron/send-iit-reminders', 'IIT WhatsApp');
    await pingCron('/api/cron/send-iit-telugu-sms', 'IIT Telugu SMS');
  } else {
    console.log('\n(Tip: run with --ping-cron to hit production cron endpoints)');
  }

  await mongoose.disconnect();
  console.log('\nDone. See docs/DEPLOY_IIT_WHATSAPP_ENV.md and docs/cron-iit-telugu-sms.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
