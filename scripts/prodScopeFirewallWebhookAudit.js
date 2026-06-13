'use strict';
/**
 * Send audit messages to production Gupshup webhook and inspect MongoDB outbounds.
 * Uses guide-xpert-backend.vercel.app (actual chatbot host; www proxy returns 405 on /webhook).
 */
require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');

const WEBHOOK = 'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const PHONE = '919876543210';
const REFUSAL_RE = /GuideXpert.*counselling assistant|cannot assist with programming/i;

const CASES = [
  { group: 'block', text: 'Write Python code for sorting', expectEvent: 'scope_blocked_shadow' },
  { group: 'block', text: 'Generate an image of a dog', expectEvent: 'scope_blocked_shadow' },
  { group: 'block', text: 'What is the weather today?', expectEvent: 'scope_blocked_shadow' },
  { group: 'block', text: 'Tell me about Avengers movie', expectEvent: 'scope_blocked_shadow' },
  { group: 'block', text: 'Should I invest in bitcoin?', expectEvent: 'scope_blocked_shadow' },
  { group: 'allow', text: 'What is JoSAA?', expectEvent: 'scope_allowed' },
  { group: 'allow', text: 'Can I get CSE in IIT Hyderabad with rank 3500?', expectEvent: 'scope_allowed' },
  { group: 'allow', text: 'Should I float or freeze?', expectEvent: 'scope_allowed' },
  { group: 'allow', text: 'What are hostel fees?', expectEvent: 'scope_allowed' },
];

function buildPayload(text, id) {
  return {
    type: 'message',
    payload: {
      source: PHONE,
      id,
      payload: { type: 'text', text },
    },
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const health = await axios.get('https://www.guidexpert.co.in/api/health', { timeout: 15000 });
  const vercelHealth = await axios.get('https://guide-xpert-backend.vercel.app/api/health', {
    timeout: 15000,
  });

  console.log('=== Step 1: Production Health ===');
  console.log('www.guidexpert.co.in scopeFirewall:', health.data.scopeFirewall ?? 'ABSENT');
  console.log('guide-xpert-backend.vercel.app scopeFirewall:', vercelHealth.data.scopeFirewall ?? 'ABSENT');

  await mongoose.connect(process.env.MONGODB_URI);
  const inboundCol = mongoose.connection.db.collection('whatsappinboundmessages');
  const outboundCol = mongoose.connection.db.collection('whatsappoutboundmessages');

  console.log('\n=== Steps 3–4: Webhook + Mongo evidence ===');
  const results = [];

  for (let i = 0; i < CASES.length; i += 1) {
    const c = CASES[i];
    const msgId = `scope-audit-${Date.now()}-${i}`;
    const started = Date.now();
    let httpStatus = null;
    let webhookBody = null;
    try {
      const res = await axios.post(WEBHOOK, buildPayload(c.text, msgId), {
        timeout: 90000,
        headers: { 'Content-Type': 'application/json' },
      });
      httpStatus = res.status;
      webhookBody = res.data;
    } catch (e) {
      httpStatus = e.response?.status || 0;
      webhookBody = e.response?.data || { error: e.message };
    }

    await sleep(1500);

    const inbound = await inboundCol.findOne(
      { providerMessageId: msgId },
      { projection: { text: 1, conversationId: 1, processStatus: 1, createdAt: 1 } }
    );
    let outbound = null;
    if (inbound?.conversationId) {
      outbound = await outboundCol
        .find({ conversationId: inbound.conversationId })
        .sort({ createdAt: -1 })
        .limit(1)
        .project({ text: 1, createdAt: 1 })
        .next();
    }

    const reply = outbound?.text || '';
    const isRefusal = REFUSAL_RE.test(reply);
    const llmLike = reply.length > 0 && !isRefusal;

    results.push({
      ...c,
      msgId,
      httpStatus,
      inboundSaved: Boolean(inbound),
      processStatus: inbound?.processStatus || null,
      durationMs: Date.now() - started,
      isRefusal,
      llmLike,
      replyPreview: reply.slice(0, 120).replace(/\n/g, ' '),
    });

    console.log(`\n[${c.group.toUpperCase()}] ${c.text}`);
    console.log(`  webhook HTTP ${httpStatus} handled=${webhookBody?.handled}`);
    console.log(`  inbound saved=${Boolean(inbound)} process=${inbound?.processStatus || '-'}`);
    console.log(`  refusal=${isRefusal} llmLike=${llmLike}`);
    console.log(`  reply: ${reply.slice(0, 100).replace(/\n/g, ' ') || '(none)'}`);
  }

  await mongoose.disconnect();

  console.log('\n=== Inference (structured logs are Vercel-only) ===');
  const healthOk =
    health.data.scopeFirewall?.enabled === true &&
    health.data.scopeFirewall?.shadowMode === true &&
    health.data.scopeFirewall?.ready === true;

  const blockCases = results.filter((r) => r.group === 'block');
  const allowCases = results.filter((r) => r.group === 'allow');
  const blockRefused = blockCases.filter((r) => r.isRefusal).length;
  const blockLlm = blockCases.filter((r) => r.llmLike).length;
  const allowRefused = allowCases.filter((r) => r.isRefusal).length;

  console.log(`Health scopeFirewall present: ${healthOk}`);
  console.log(`Block cases with LLM-like reply (shadow expected): ${blockLlm}/${blockCases.length}`);
  console.log(`Block cases with refusal (enforce mode): ${blockRefused}/${blockCases.length}`);
  console.log(`Allow cases wrongly refused (false positive): ${allowRefused}/${allowCases.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
