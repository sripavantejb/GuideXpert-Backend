'use strict';

/**
 * Flow V3 production smoke — end-to-end verification for a single phone number.
 *
 * Injects synthetic inbounds into the SAME pipeline a real Gupshup webhook uses
 * (runProductionConversationSmokeSend → executeClaimedInboundProcessing →
 * processInbound → Flow V3 dispatcher → whatsappOutbound → gupshupSession),
 * then reads FlowV3TurnLog to prove per turn:
 *
 *   1. the message routed into Flow V3 live (not V2 / shadow),
 *   2. the reply was genuine LLM output (blocked=false, fallbackTier=null,
 *      envelope present) — not fallback ladder Tier A/B/C,
 *   3. the exact system prompt version + hash used matches the current
 *      admin-saved prompt in Mongo,
 *   4. gates, tool calls, validation verdicts, delivery status and latency.
 *
 * Delivery: when GUPSHUP_API_KEY/GUPSHUP_SOURCE are configured, REAL WhatsApp
 * messages are delivered to the target phone. When they are not (local dev),
 * the script auto-enables WA_INTEGRATION_STUB=1 so the final Gupshup HTTP call
 * is simulated — everything upstream (routing, gates, real LLM call, tools,
 * validation, render, outbound records, turn log) still runs for real.
 *
 * Usage:
 *   node scripts/flowV3ProductionSmoke.js --phone=9347763131
 *   node scripts/flowV3ProductionSmoke.js --phone=9347763131 --keep-state
 *   node scripts/flowV3ProductionSmoke.js --phone=9347763131 --message="custom single turn"
 */

require('../config/mongooseSafety');
require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');

const {
  isFlowV3Enabled,
  getFlowV3Mode,
  getCanaryPercent,
  phoneCanaryBucket,
  resolveFlowV3Routing,
} = require('../services/chatbot/flowV3LLM/flowV3Rollout');
const { resolveSystemPromptForAdmin } = require('../utils/systemPromptSettings');
const { HOLDING_REPLY, STATIC_ACK } = require('../services/chatbot/flowV3LLM/validate/fallbackLadder');
const FlowV3TurnLog = require('../models/FlowV3TurnLog');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');

const DEFAULT_TURNS = [
  'Hi',
  'I just finished 12th with MPC, got 78%. I am confused about which engineering branch to choose.',
  'Which is better for an AI career, CSE or ECE?',
];

const TURN_LOG_POLL_MS = 500;
const TURN_LOG_POLL_TIMEOUT_MS = 15000;
const INTER_TURN_DELAY_MS = 2000;

/**
 * Same injection as services/smoke/productionConversationSmokeService.js
 * (synthetic webhook event + inbound → executeClaimedInboundProcessing),
 * but without the hard requirement on real Gupshup credentials so it can run
 * with stubbed delivery in local dev.
 */
async function injectInboundTurn({ phone10, message, resetState, caseId }) {
  const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
  const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
  const WhatsAppConversation = require('../models/WhatsAppConversation');
  const { sanitizeInboundSnippet } = require('../utils/gupshupInboundPayload');
  const { getOrCreateConversation, touchInbound } = require('../services/chatbot/conversationService');
  const { resetToMainMenu } = require('../services/chatbot/botStateService');
  const { executeClaimedInboundProcessing } = require('../services/chatbot/whatsappInboundService');

  const receivedAt = new Date();
  const smokeNonce = crypto.randomBytes(12).toString('hex');
  const providerMessageId = `smoke:${smokeNonce}`;
  const dedupeKey = `flowv3_smoke:${phone10}:${smokeNonce}`;

  const { conversation, leadLinks } = await getOrCreateConversation(phone10);

  if (resetState) {
    await resetToMainMenu(conversation._id, phone10, { reason: 'flowv3_production_smoke' });
    await WhatsAppConversation.updateOne(
      { _id: conversation._id },
      { $set: { status: 'active', currentHandoffId: null } }
    );
  }

  const freshConversation = await WhatsAppConversation.findById(conversation._id);
  const smokePayload = {
    source: 'flowv3_production_smoke',
    caseId,
    phone10,
    text: message,
    providerMessageId,
  };

  const webhookEvent = await WhatsAppWebhookEvent.create({
    eventKind: 'inbound',
    webhookDedupeKey: `smoke:${dedupeKey}`,
    receivedAt,
    phone: phone10,
    status: 'inbound',
    rawPayloadSnippet: sanitizeInboundSnippet(smokePayload, 1500),
    matchedBy: 'production_smoke',
    matchConfidence: 'high',
  });

  const inboundDoc = await WhatsAppInboundMessage.create({
    conversationId: freshConversation._id,
    phone: phone10,
    providerMessageId,
    messageType: 'text',
    text: message,
    interactivePayload: null,
    mediaUrl: null,
    location: null,
    rawPayloadSnippet: sanitizeInboundSnippet(smokePayload, 1500),
    receivedAt,
    processStatus: 'pending',
    dedupeKey,
    whatsappWebhookEventId: webhookEvent._id,
  });

  await WhatsAppWebhookEvent.updateOne(
    { _id: webhookEvent._id },
    { $set: { inboundMessageId: inboundDoc._id } }
  );
  await touchInbound(freshConversation._id, receivedAt);

  const processResult = await executeClaimedInboundProcessing({
    conversation: freshConversation,
    inbound: inboundDoc,
    leadLinks,
    phone10,
  });

  return {
    inboundId: String(inboundDoc._id),
    conversationId: String(freshConversation._id),
    intent: processResult?.intent || null,
    outboundSuccess: processResult?.outboundSuccess ?? null,
    processSkipped: Boolean(processResult?.skipped),
    processReason: processResult?.reason || processResult?.error || null,
  };
}

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

async function pollTurnLog(inboundId) {
  const deadline = Date.now() + TURN_LOG_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const doc = await FlowV3TurnLog.findOne({ inboundId: String(inboundId) }).lean();
    if (doc) return doc;
    await sleep(TURN_LOG_POLL_MS);
  }
  return null;
}

function classifyOrigin(turnLog, replyTexts) {
  if (!turnLog) return { verdict: 'NO_TURN_LOG', genuineLlm: false };
  if (turnLog.deliveryStatus === 'gate_terminated') {
    return { verdict: 'GATE_TERMINATED (deterministic gate reply, LLM never called)', genuineLlm: false };
  }
  if (turnLog.fallbackTier) {
    return {
      verdict: `FALLBACK TIER ${turnLog.fallbackTier} (deterministic, NOT LLM)`,
      genuineLlm: false,
    };
  }
  const staticMatch = replyTexts.some((t) => t === HOLDING_REPLY || t === STATIC_ACK);
  if (staticMatch) {
    return { verdict: 'STATIC FALLBACK TEXT DETECTED (NOT LLM)', genuineLlm: false };
  }
  // Note: dispatcher does not currently populate llmCalls in the turn log, so
  // origin is judged on blocked/fallbackTier/envelope (the authoritative trio).
  if (!turnLog.blocked && turnLog.envelope) {
    return { verdict: 'GENUINE LLM RESPONSE', genuineLlm: true };
  }
  return { verdict: 'INDETERMINATE (blocked without fallback tier, or no envelope)', genuineLlm: false };
}

function printTurnReport(turnNo, message, sendResult, turnLog, outbounds, expectedPromptHash) {
  hr(`TURN ${turnNo}: "${message}"`);

  console.log('\n[ROUTING]');
  console.log(`  intent (pipeline)      : ${sendResult.intent || '(not surfaced by processInbound return)'}`);
  console.log(`  Flow V3 turn log       : ${turnLog ? 'FOUND — turn ran through the Flow V3 LLM dispatcher' : 'NOT FOUND'}`);

  console.log('\n[BOT REPLY delivered to WhatsApp]');
  if (outbounds.length === 0) {
    console.log('  (no outbound found)');
  }
  for (const ob of outbounds) {
    console.log(`  [part ${ob.partIndex ?? 0}] status=${ob.status} gupshupId=${ob.gupshupMessageId || 'n/a'}`);
    console.log(`    ${String(ob.textPreview || '').split('\n').join('\n    ')}`);
  }

  if (!turnLog) {
    console.log('\n[TURN LOG] NOT FOUND after 15s — turn likely did NOT run through Flow V3.');
    return { genuineLlm: false, promptHashMatch: false, verdict: 'NO_TURN_LOG' };
  }

  console.log('\n[SYSTEM PROMPT used this turn]');
  console.log(`  promptVersion          : ${turnLog.promptVersion}`);
  console.log(`  promptHash             : ${turnLog.promptHash}`);
  const promptHashMatch = Boolean(expectedPromptHash) && turnLog.promptHash === expectedPromptHash;
  console.log(`  matches admin prompt   : ${promptHashMatch ? 'YES — your new prompt was used' : `NO (expected ${expectedPromptHash})`}`);

  console.log('\n[GATES]');
  for (const g of turnLog.gateVerdicts || []) {
    console.log(`  ${g.gate}: ${g.verdict}${g.reason ? ` (${g.reason})` : ''}${g.terminatedTurn ? ' [TERMINATED TURN]' : ''}`);
  }

  console.log('\n[LLM CALLS]');
  const llmCalls = turnLog.llmCalls || [];
  console.log(`  count                  : ${llmCalls.length}`);
  llmCalls.forEach((c, i) => {
    console.log(
      `  call ${i + 1}: latency=${c.latencyMs ?? '?'}ms tokensIn=${c.tokensIn ?? '?'} tokensOut=${c.tokensOut ?? '?'}${c.timedOut ? ' TIMED_OUT' : ''}${c.error ? ` error=${c.error}` : ''}`
    );
  });

  console.log('\n[TOOL CALLS]');
  const toolCalls = turnLog.toolCalls || [];
  if (toolCalls.length === 0) console.log('  none');
  for (const t of toolCalls) {
    console.log(`  ${t.name}${t.cached ? ' (cached)' : ''}${t.refused ? ' REFUSED' : ''}${t.failed ? ' FAILED' : ''} latency=${t.latencyMs ?? '?'}ms`);
  }

  console.log('\n[ENVELOPE + VALIDATION]');
  console.log(`  envelope.intent        : ${turnLog.envelope?.intent ?? 'null'}`);
  console.log(`  blocked                : ${turnLog.blocked}`);
  console.log(`  regenerated            : ${turnLog.regenerated}`);
  console.log(`  fallbackTier           : ${turnLog.fallbackTier ?? 'null'}`);
  for (const v of turnLog.validationVerdicts || []) {
    console.log(`  ${v.check}: ${v.verdict}${v.detail ? ` (${v.detail})` : ''}`);
  }

  console.log('\n[PROFILE EXTRACTION]');
  console.log(`  slotPatch              : ${JSON.stringify(turnLog.slotPatch ?? null)}`);

  console.log('\n[DELIVERY + LATENCY]');
  console.log(`  deliveryStatus         : ${turnLog.deliveryStatus}`);
  console.log(`  sentParts              : ${(turnLog.sentParts || []).map((p) => `#${p.partIndex}:${p.sent ? 'sent' : 'NOT_SENT'}`).join(' ') || 'none'}`);
  const lb = turnLog.latencyBreakdown || {};
  console.log(
    `  latency (ms)           : total=${lb.totalMs ?? '?'} gates=${lb.gatesMs ?? '?'} llm1=${lb.llmCall1Ms ?? '?'} tools=${lb.toolsMs ?? '?'} llm2=${lb.llmCall2Ms ?? '?'} validation=${lb.validationMs ?? '?'}${lb.budgetExceeded ? ' BUDGET_EXCEEDED' : ''}`
  );

  const replyTexts = outbounds.map((o) => String(o.textPreview || ''));
  const origin = classifyOrigin(turnLog, replyTexts);
  console.log('\n[ORIGIN VERDICT]');
  console.log(`  >>> ${origin.verdict}`);

  return { genuineLlm: origin.genuineLlm, promptHashMatch, verdict: origin.verdict };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.phone || String(args.phone).replace(/\D/g, '').length < 10) {
    console.error('Usage: node scripts/flowV3ProductionSmoke.js --phone=9347763131 [--keep-state] [--message="..."]');
    process.exit(2);
  }
  const phone10 = String(args.phone).replace(/\D/g, '').slice(-10);

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set.');
    process.exit(2);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to Mongo (db: ${mongoose.connection.name})`);

  hr('PRE-FLIGHT: ROLLOUT + PROMPT + LLM CONFIG');

  const routing = resolveFlowV3Routing({ phone: phone10 });
  console.log('\n[FLOW V3 ROLLOUT]');
  console.log(`  CHATBOT_FLOW_V3_ENABLED : ${isFlowV3Enabled() ? '1 (on)' : 'off'}`);
  console.log(`  mode                    : ${getFlowV3Mode()}`);
  console.log(`  canary percent          : ${getCanaryPercent()}`);
  console.log(`  phone canary bucket     : ${phoneCanaryBucket(phone10)} (must be < canary percent for live)`);
  console.log(`  routing decision        : useV3=${routing.useV3} mode=${routing.mode} reason=${routing.reason}`);
  if (!routing.useV3 || routing.mode !== 'live') {
    console.error('\nThis phone will NOT route into Flow V3 live. Fix rollout flags first. Aborting.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const adminPrompt = await resolveSystemPromptForAdmin();
  console.log('\n[ACTIVE SYSTEM PROMPT (admin source of truth)]');
  console.log(`  source                  : ${adminPrompt.source}`);
  console.log(`  hash                    : ${adminPrompt.hash}`);
  console.log(`  bytes                   : ${adminPrompt.bytes}`);
  console.log(`  updatedAt               : ${adminPrompt.updatedAt || 'n/a'}`);
  console.log(`  updatedBy               : ${adminPrompt.updatedByEmail || 'n/a'}`);
  console.log(`  first line              : ${String(adminPrompt.text || '').split('\n')[0].slice(0, 100)}`);

  console.log('\n[LLM PROVIDER]');
  console.log(`  LLM_BASE_URL            : ${process.env.LLM_BASE_URL || 'MISSING'}`);
  console.log(`  LLM_MODEL               : ${process.env.LLM_MODEL || 'MISSING'}`);
  console.log(`  LLM_API_KEY             : ${process.env.LLM_API_KEY ? 'set' : 'MISSING'}`);

  const { isGupshupOutboundConfigured } = require('../utils/gupshupCredentialValidation');
  console.log('\n[WHATSAPP DELIVERY]');
  if (isGupshupOutboundConfigured()) {
    console.log('  mode                    : REAL — replies will be delivered to WhatsApp');
  } else {
    process.env.WA_INTEGRATION_STUB = '1';
    console.log('  mode                    : STUBBED — Gupshup credentials not set on this machine.');
    console.log('                            The pipeline (routing → gates → real LLM → validation → render)');
    console.log('                            runs for real; only the final WhatsApp HTTP send is simulated.');
  }

  const turns = args.message ? [args.message] : DEFAULT_TURNS;
  const results = [];

  for (let i = 0; i < turns.length; i++) {
    const message = turns[i];
    const resetState = i === 0 && !args.keepState;

    let sendResult;
    try {
      sendResult = await injectInboundTurn({
        phone10,
        message,
        resetState,
        caseId: `flowv3-smoke-turn-${i + 1}`,
      });
    } catch (err) {
      hr(`TURN ${i + 1}: "${message}"`);
      console.error(`SEND FAILED: ${err.message}`);
      results.push({ turn: i + 1, message, genuineLlm: false, promptHashMatch: false, verdict: `SEND_FAILED: ${err.message}` });
      continue;
    }

    const turnLog = await pollTurnLog(sendResult.inboundId);
    const outbounds = await WhatsAppOutboundMessage.find({
      inReplyToInboundId: sendResult.inboundId,
      senderType: 'bot',
    })
      .sort({ partIndex: 1, createdAt: 1 })
      .lean();

    const report = printTurnReport(i + 1, message, sendResult, turnLog, outbounds, adminPrompt.hash);
    results.push({ turn: i + 1, message, ...report });

    if (i < turns.length - 1) await sleep(INTER_TURN_DELAY_MS);
  }

  hr('FINAL SUMMARY');
  let allPass = true;
  for (const r of results) {
    const pass = r.genuineLlm && r.promptHashMatch;
    if (!pass) allPass = false;
    console.log(`  Turn ${r.turn}: ${pass ? 'PASS' : 'FAIL'} — ${r.verdict}${r.promptHashMatch ? ' | prompt hash matched' : ' | prompt hash NOT matched'}`);
  }
  console.log(`\n  OVERALL: ${allPass ? 'PASS — replies are genuine LLM output using your new system prompt' : 'FAIL — see turn details above'}`);

  await mongoose.disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Smoke run crashed:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
