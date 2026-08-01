'use strict';

/**
 * PRODUCTION webhook smoke — injects a synthetic Gupshup inbound into the
 * DEPLOYED backend (https://guide-xpert-backend.vercel.app/webhook/gupshup),
 * exactly the path a real WhatsApp message takes. Replies are REAL: production
 * sends them to the target phone via Gupshup.
 *
 * Verification happens through the shared production Mongo:
 *   - inbound row created + processed
 *   - outbound rows (text, gupshup message id, delivery status)
 *   - bot state / engine that handled the turn
 *   - FlowV3TurnLog rows (only if production has Flow V3 enabled + fixed code)
 *
 * Usage:
 *   node scripts/prodWebhookSmoke.js --phone=9347763131
 *   node scripts/prodWebhookSmoke.js --phone=9347763131 --keep-state
 *   node scripts/prodWebhookSmoke.js --phone=9347763131 --message="one custom turn"
 */

require('../config/mongooseSafety');
require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');

const PROD_BASE = process.env.PRODUCTION_SMOKE_BASE_URL || 'https://guide-xpert-backend.vercel.app';

const DEFAULT_TURNS = [
  'Hi',
  'I just finished 12th with MPC, got 78%. I am confused about which engineering branch to choose.',
  'Which is better for an AI career, CSE or ECE?',
];

const POLL_MS = 1500;
const INBOUND_TIMEOUT_MS = 30000;
const OUTBOUND_TIMEOUT_MS = 45000;
const DELIVERY_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  const args = { phone: null, keepState: false, message: null };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith('--phone=')) args.phone = raw.slice('--phone='.length);
    else if (raw === '--keep-state') args.keepState = true;
    else if (raw.startsWith('--message=')) args.message = raw.slice('--message='.length);
  }
  return args;
}

function hr(label) {
  console.log(`\n${'='.repeat(72)}\n${label}\n${'='.repeat(72)}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(POLL_MS);
  }
  return null;
}

async function postWebhook(payload) {
  const res = await fetch(`${PROD_BASE}/webhook/gupshup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text().catch(() => '') };
}

async function main() {
  const args = parseArgs(process.argv);
  const phone10 = String(args.phone || '').replace(/\D/g, '').slice(-10);
  if (phone10.length !== 10) {
    console.error('Usage: node scripts/prodWebhookSmoke.js --phone=9347763131 [--keep-state] [--message="..."]');
    process.exit(2);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to shared production Mongo (db: ${mongoose.connection.name})`);

  const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
  const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
  const WhatsAppBotState = require('../models/WhatsAppBotState');
  const FlowV3TurnLog = require('../models/FlowV3TurnLog');
  const { getOrCreateConversation } = require('../services/chatbot/conversationService');
  const { resetToMainMenu } = require('../services/chatbot/botStateService');
  const { resolveSystemPromptForAdmin } = require('../utils/systemPromptSettings');

  hr('PRE-FLIGHT: DEPLOYED PRODUCTION STATE');
  const health = await (await fetch(`${PROD_BASE}/api/health`)).json();
  console.log(`  target                 : ${PROD_BASE}`);
  console.log(`  whatsapp ready         : ${health.whatsapp?.ready} (gupshupConfigured=${health.whatsapp?.gupshupConfigured})`);
  console.log(`  flowV3 (production)    : enabled=${health.flowV3?.enabled} mode=${health.flowV3?.mode} canary=${health.flowV3?.canaryPercent}`);
  if (!health.flowV3?.enabled) {
    console.log('  NOTE: Flow V3 is DISABLED on production — turns will be handled by the legacy V2 flow.');
  }
  const adminPrompt = await resolveSystemPromptForAdmin();
  console.log(`  admin prompt (Mongo)   : hash=${adminPrompt.hash} source=${adminPrompt.source} updatedAt=${adminPrompt.updatedAt}`);

  const { conversation } = await getOrCreateConversation(phone10);
  console.log(`  conversationId         : ${conversation._id}`);

  if (!args.keepState) {
    await resetToMainMenu(conversation._id, phone10, { reason: 'prod_webhook_smoke' });
    console.log('  bot state              : reset to main menu for a clean run');
  }

  const turns = args.message ? [args.message] : DEFAULT_TURNS;
  const results = [];

  for (let i = 0; i < turns.length; i++) {
    const message = turns[i];
    const nonce = crypto.randomBytes(8).toString('hex');
    const providerMessageId = `prod-smoke-${nonce}`;

    hr(`TURN ${i + 1}: "${message}"`);

    const payload = {
      app: 'GuideXpert',
      type: 'message',
      timestamp: Date.now(),
      payload: {
        id: providerMessageId,
        source: `91${phone10}`,
        type: 'text',
        payload: { text: message },
        sender: { phone: `91${phone10}`, name: 'ProdSmoke', country_code: '91' },
      },
    };

    const post = await postWebhook(payload);
    console.log(`  webhook POST           : HTTP ${post.status} ${post.body.slice(0, 120)}`);
    if (post.status >= 400) {
      results.push({ turn: i + 1, ok: false, detail: `webhook rejected: ${post.status}` });
      continue;
    }

    const inbound = await pollFor(
      () => WhatsAppInboundMessage.findOne({ providerMessageId }).lean(),
      INBOUND_TIMEOUT_MS
    );
    if (!inbound) {
      console.log('  inbound row            : NOT FOUND after 30s — production did not ingest the message');
      results.push({ turn: i + 1, ok: false, detail: 'inbound not ingested' });
      continue;
    }
    console.log(`  inbound row            : ${inbound._id} (processStatus=${inbound.processStatus})`);

    let outbounds = await pollFor(async () => {
      const rows = await WhatsAppOutboundMessage.find({
        inReplyToInboundId: inbound._id,
        senderType: 'bot',
      })
        .sort({ partIndex: 1, createdAt: 1 })
        .lean();
      return rows.length ? rows : null;
    }, OUTBOUND_TIMEOUT_MS);

    if (!outbounds) {
      const fresh = await WhatsAppInboundMessage.findById(inbound._id).lean();
      console.log(`  bot reply              : NONE after 45s (inbound processStatus=${fresh?.processStatus}, error=${fresh?.processError || 'n/a'})`);
      results.push({ turn: i + 1, ok: false, detail: 'no outbound reply' });
      continue;
    }

    // Give DLR callbacks a chance to upgrade status to delivered/read.
    await pollFor(async () => {
      outbounds = await WhatsAppOutboundMessage.find({
        inReplyToInboundId: inbound._id,
        senderType: 'bot',
      })
        .sort({ partIndex: 1, createdAt: 1 })
        .lean();
      return outbounds.every((o) => ['delivered', 'read'].includes(o.status)) ? outbounds : null;
    }, DELIVERY_TIMEOUT_MS);

    console.log('\n  [BOT REPLY sent to your WhatsApp]');
    for (const ob of outbounds) {
      console.log(`  [part ${ob.partIndex ?? 0}] status=${ob.status} gupshupId=${ob.gupshupMessageId || 'n/a'}`);
      console.log(`    ${String(ob.textPreview || '(interactive/non-text)').split('\n').join('\n    ')}`);
    }

    const botState = await WhatsAppBotState.findOne({ conversationId: conversation._id }).lean();
    const flowV3Pin = botState?.context?.flowV3 || null;
    console.log('\n  [ENGINE]');
    console.log(`  bot state              : ${botState?.state || 'n/a'}`);
    console.log(`  flowV3 pin             : ${flowV3Pin ? JSON.stringify({ engine: flowV3Pin.engine, mode: flowV3Pin.mode, promptVersion: flowV3Pin.promptVersion }) : 'none (legacy V2 handled this turn)'}`);

    const turnLog = await FlowV3TurnLog.findOne({ inboundId: String(inbound._id) }).lean();
    if (turnLog) {
      console.log('\n  [FLOW V3 TURN LOG]');
      console.log(`  promptHash             : ${turnLog.promptHash} (admin prompt: ${adminPrompt.hash})`);
      console.log(`  blocked=${turnLog.blocked} fallbackTier=${turnLog.fallbackTier} envelope.intent=${turnLog.envelope?.intent ?? 'null'}`);
    } else {
      console.log('\n  [FLOW V3 TURN LOG] none (expected while production has V3 disabled / unfixed logging)');
    }

    const delivered = outbounds.some((o) => ['submitted', 'sent', 'delivered', 'read'].includes(o.status) && o.gupshupMessageId);
    results.push({
      turn: i + 1,
      ok: Boolean(delivered),
      detail: `reply parts=${outbounds.length}, statuses=${outbounds.map((o) => o.status).join(',')}, v3=${turnLog ? 'yes' : 'no'}`,
    });

    if (i < turns.length - 1) await sleep(2000);
  }

  hr('FINAL SUMMARY');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    console.log(`  Turn ${r.turn}: ${r.ok ? 'PASS' : 'FAIL'} — ${r.detail}`);
  }
  console.log(`\n  OVERALL: ${allOk ? 'PASS — production ingested, processed and sent real WhatsApp replies' : 'FAIL — see turn details'}`);

  await mongoose.disconnect();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Prod smoke crashed:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
