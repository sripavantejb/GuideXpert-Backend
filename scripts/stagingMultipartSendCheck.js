'use strict';

require('../config/mongooseSafety');

/**
 * G-2b staging verification — proves three REAL WhatsApp bubbles land.
 *
 * Unit coverage mocks Gupshup, so it cannot prove provider-side delivery or the
 * media/ACK ordering gap the multipart mitigation depends on. Run this against
 * staging before canary.
 *
 * Usage (dry-run prints the plan and sends nothing):
 *   node scripts/stagingMultipartSendCheck.js --phone 9876543210
 *   node scripts/stagingMultipartSendCheck.js --phone 9876543210 --execute
 *
 * Refuses to run when NODE_ENV=production.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const outbound = require('../services/chatbot/whatsappOutboundService');

const EXECUTE = process.argv.includes('--execute');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const PHONE = argValue('--phone');

// Operational probe text only — not student-facing counseling copy.
const PARTS = Object.freeze([
  'GuideXpert delivery check 1 of 3.',
  'GuideXpert delivery check 2 of 3.',
  'GuideXpert delivery check 3 of 3.',
]);

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the staging send check with NODE_ENV=production');
  }
  if (!PHONE || !/^\d{10}$/.test(PHONE)) {
    throw new Error('--phone <10 digits> is required');
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const conversationId = new mongoose.Types.ObjectId();
  const inboundId = new mongoose.Types.ObjectId();

  console.log(
    JSON.stringify({
      event: 'staging_send_plan',
      execute: EXECUTE,
      phoneTail: PHONE.slice(-4),
      parts: PARTS.length,
      inboundId: String(inboundId),
    })
  );

  if (!EXECUTE) {
    console.log(JSON.stringify({ event: 'dry_run_complete', note: 'pass --execute to send' }));
    await mongoose.disconnect();
    return;
  }

  const results = [];
  for (let partIndex = 0; partIndex < PARTS.length; partIndex += 1) {
    const result = await outbound.sendBotTextReply({
      conversationId,
      phone10: PHONE,
      text: PARTS[partIndex],
      inReplyToInboundId: inboundId,
      partIndex,
    });
    results.push({ partIndex, success: result.success, outboundId: String(result.outboundId) });
    console.log(JSON.stringify({ event: 'part_sent', partIndex, success: result.success }));
  }

  const rows = await WhatsAppOutboundMessage.find({
    inReplyToInboundId: inboundId,
    senderType: 'bot',
  })
    .select('partIndex status gupshupMessageId')
    .sort({ partIndex: 1 })
    .lean();

  const sentPartCount = results.filter((r) => r.success).length;

  // Replay: a retry of the same tuples must send zero additional messages.
  const replay = [];
  for (let partIndex = 0; partIndex < PARTS.length; partIndex += 1) {
    const result = await outbound.sendBotTextReply({
      conversationId,
      phone10: PHONE,
      text: PARTS[partIndex],
      inReplyToInboundId: inboundId,
      partIndex,
    });
    replay.push({ partIndex, duplicatePrevented: Boolean(result.duplicatePrevented) });
  }

  const rowsAfterReplay = await WhatsAppOutboundMessage.countDocuments({
    inReplyToInboundId: inboundId,
    senderType: 'bot',
  });

  const verdict = {
    event: 'staging_send_verdict',
    envelopePartCount: PARTS.length,
    sentPartCount,
    persistedRows: rows.length,
    partIndexes: rows.map((r) => r.partIndex),
    providerIds: rows.map((r) => r.gupshupMessageId),
    replayAllDuplicatePrevented: replay.every((r) => r.duplicatePrevented),
    rowsAfterReplay,
    pass:
      sentPartCount === PARTS.length &&
      rows.length === PARTS.length &&
      rowsAfterReplay === PARTS.length &&
      replay.every((r) => r.duplicatePrevented),
    manualCheck: 'CONFIRM ON THE HANDSET: three separate bubbles arrived, in order',
  };
  console.log(JSON.stringify(verdict));

  await mongoose.disconnect();
  if (!verdict.pass) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
