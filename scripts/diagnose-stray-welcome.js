#!/usr/bin/env node
/**
 * Check whether "Welcome" outbounds come from GuideXpert Mongo vs Gupshup/Meta.
 * Usage: node scripts/diagnose-stray-welcome.js [phone10_suffix]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');

const phoneSuffix = process.argv[2] || null;
const hours = parseInt(process.env.DIAGNOSE_HOURS || '48', 10) || 48;

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const phoneFilter = phoneSuffix
    ? { phone: new RegExp(`${phoneSuffix}$`) }
    : {};

  const exactWelcome = await WhatsAppOutboundMessage.countDocuments({
    createdAt: { $gte: since },
    senderType: 'bot',
    textPreview: /^Welcome$/i,
    ...phoneFilter,
  });

  const welcomeBack = await WhatsAppOutboundMessage.countDocuments({
    createdAt: { $gte: since },
    senderType: 'bot',
    textPreview: /Welcome back to GuideXpert/i,
    ...phoneFilter,
  });

  const recentBot = await WhatsAppOutboundMessage.find({
    createdAt: { $gte: since },
    senderType: 'bot',
    ...phoneFilter,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('createdAt phone textPreview status webhookErrorReason')
    .lean();

  const recentIn = await WhatsAppInboundMessage.find({
    createdAt: { $gte: since },
    ...phoneFilter,
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('createdAt phone text processStatus processError')
    .lean();

  console.log(`\nStray Welcome diagnostic (last ${hours}h)${phoneSuffix ? `, phone ***${phoneSuffix}` : ''}\n`);
  console.log(`  Bot outbounds with text exactly "Welcome": ${exactWelcome}`);
  console.log(`  Bot outbounds containing "Welcome back to GuideXpert": ${welcomeBack}`);
  console.log('\n  Recent bot outbounds (newest first):');
  for (const r of recentBot) {
    const preview = String(r.textPreview || '').replace(/\n/g, ' ').slice(0, 90);
    console.log(
      `    ${r.createdAt.toISOString()} ***${String(r.phone).slice(-4)} [${r.status}] ${preview}`
    );
    if (r.webhookErrorReason) {
      console.log(`      error: ${String(r.webhookErrorReason).slice(0, 80)}`);
    }
  }
  console.log('\n  Recent inbounds:');
  for (const r of recentIn) {
    console.log(
      `    ${r.createdAt.toISOString()} ***${String(r.phone).slice(-4)} "${(r.text || '').slice(0, 30)}" → ${r.processStatus}${r.processError ? ` (${String(r.processError).slice(0, 60)})` : ''}`
    );
  }

  console.log('\nInterpretation:');
  if (exactWelcome === 0) {
    console.log(
      '  • A separate WhatsApp bubble that says only "Welcome" is NOT stored here → disable Gupshup Journey / Meta Greeting (see docs/gupshup-disable-auto-welcome.md).'
    );
  }
  if (welcomeBack > 0) {
    console.log(
      '  • "Welcome back to GuideXpert" in previews is from older deploys; new code omits that line after commit 4a17e8e.'
    );
  }
  console.log('');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
