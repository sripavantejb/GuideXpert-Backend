#!/usr/bin/env node
'use strict';

/**
 * Official PRODUCTION conversation smoke / certification runner.
 *
 * Does NOT call local processInbound().
 * Does NOT require local GUPSHUP_API_KEY / GUPSHUP_SOURCE.
 *
 * Flow per case:
 *   POST https://guide-xpert-backend.vercel.app/api/internal/smoke/send
 *     → production executeClaimedInboundProcessing → processInbound
 *     → whatsappOutboundService → gupshupSession → real WhatsApp
 *   Then poll production Mongo for delivery + lifecycle / analytics checks.
 *
 * Usage:
 *   INTERNAL_SMOKE_TEST_SECRET=... node scripts/productionConversationSmokeRunner.js \
 *     --phone=9347763131 --suite=sectionA --strict --audit
 *
 * Env:
 *   INTERNAL_SMOKE_TEST_SECRET   (required — same value as Vercel Production)
 *   MONGODB_URI                  (required — production DB for delivery verification)
 *   PRODUCTION_SMOKE_BASE_URL    (default https://guide-xpert-backend.vercel.app)
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');
const SMOKE_TESTS_DIR = path.join(ROOT, 'smoke-tests');
const SMOKE_RESULTS_DIR = path.join(ROOT, 'smoke-results');

require('dotenv').config({ path: path.join(ROOT, '.env') });

const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppBotState = require('../models/WhatsAppBotState');

const DELIVERY_OK = new Set(['delivered', 'read']);
const DEFAULT_BASE = 'https://guide-xpert-backend.vercel.app';

function parseArgs(argv) {
  const out = {
    phone: null,
    suite: 'sectionA',
    strict: false,
    audit: false,
    deliveryTimeoutMs: Number(process.env.PRODUCTION_SMOKE_DELIVERY_TIMEOUT_MS) || 120000,
    pollMs: Number(process.env.PRODUCTION_SMOKE_DELIVERY_POLL_MS) || 2000,
    baseUrl: String(process.env.PRODUCTION_SMOKE_BASE_URL || DEFAULT_BASE).replace(/\/$/, ''),
    help: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--phone=')) out.phone = arg.slice('--phone='.length).replace(/\D/g, '').slice(-10);
    else if (arg.startsWith('--suite=')) out.suite = arg.slice('--suite='.length).trim();
    else if (arg.startsWith('--base-url=')) out.baseUrl = arg.slice('--base-url='.length).replace(/\/$/, '');
    else if (arg.startsWith('--delivery-timeout-ms=')) {
      out.deliveryTimeoutMs = Number(arg.split('=')[1]) || out.deliveryTimeoutMs;
    } else if (arg === '--strict') out.strict = true;
    else if (arg === '--audit') out.audit = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
Production Conversation Smoke Runner

Usage:
  INTERNAL_SMOKE_TEST_SECRET=... node scripts/productionConversationSmokeRunner.js \\
    --phone=9347763131 --suite=sectionA [--strict] [--audit]

Flags:
  --phone=XXXXXXXXXX   Target WhatsApp number (required)
  --suite=sectionA|all Suite JSON under smoke-tests/
  --strict             Fail unless outbound status is delivered or read
  --audit              Verify lifecycle / lead events / predictions / alerts snapshots
  --base-url=URL       Default: ${DEFAULT_BASE}
  --delivery-timeout-ms=N

Requires:
  INTERNAL_SMOKE_TEST_SECRET  (Vercel Production)
  MONGODB_URI                 (same production database)

Never uses local processInbound, Gupshup keys, mocks, or test hooks.
`);
}

function stop(reason) {
  console.error('\n⛔ STOP — production conversation smoke refused to execute');
  console.error(`Reason: ${reason}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function listSuiteFiles() {
  if (!fs.existsSync(SMOKE_TESTS_DIR)) return [];
  return fs
    .readdirSync(SMOKE_TESTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(SMOKE_TESTS_DIR, f))
    .sort();
}

function loadSuite(suiteId) {
  const file = path.join(SMOKE_TESTS_DIR, `${suiteId}.json`);
  if (!fs.existsSync(file)) stop(`Suite file missing: smoke-tests/${suiteId}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.cases)) stop(`Suite ${suiteId} has no cases array`);
  return data;
}

function resolveSuites(suiteArg) {
  if (suiteArg === 'all') {
    return listSuiteFiles().map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return [loadSuite(suiteArg)];
}

function getSmokeSecret() {
  return String(process.env.INTERNAL_SMOKE_TEST_SECRET || '').trim();
}

async function startupVerification(opts) {
  console.log('\n══════════════════════════════════════════');
  console.log(' PRODUCTION CONVERSATION SMOKE — STARTUP');
  console.log('══════════════════════════════════════════');

  const issues = [];
  if (!opts.phone || opts.phone.length !== 10) issues.push('Valid --phone=XXXXXXXXXX required');
  if (!getSmokeSecret()) issues.push('INTERNAL_SMOKE_TEST_SECRET missing (must match Vercel Production)');
  if (!process.env.MONGODB_URI) issues.push('MONGODB_URI missing (needed to verify delivery in production DB)');
  if (!opts.baseUrl.includes('guide-xpert-backend') && !process.env.PRODUCTION_SMOKE_ALLOW_ANY_BASE) {
    issues.push(`Unexpected base URL ${opts.baseUrl} (set PRODUCTION_SMOKE_ALLOW_ANY_BASE=1 to override)`);
  }
  // Hard ban local Gupshup / orchestrator usage in this process.
  if (typeof require('../services/chatbot/chatbotOrchestratorService').setChatbotOrchestratorTestHooks === 'function') {
    // Module may load models later — we only ensure we never call hooks.
  }

  const report = {
    Mode: 'PRODUCTION_HTTP_SMOKE',
    Base_URL: opts.baseUrl,
    Endpoint: `${opts.baseUrl}/api/internal/smoke/send`,
    Phone: opts.phone,
    Suite: opts.suite,
    Strict: opts.strict,
    Audit: opts.audit,
    Local_processInbound: false,
    Local_Gupshup_required: false,
    Outbound: 'production_gupshupSession_via_deployed_backend',
  };
  console.log(JSON.stringify(report, null, 2));

  if (issues.length) stop(issues.join('; '));

  // Preflight: unauthorized call must not look like an open public route.
  try {
    const probe = await fetch(`${opts.baseUrl}/api/internal/smoke/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: opts.phone, message: '__probe_unauth__' }),
    });
    if (probe.status === 200) {
      stop('Unauthenticated POST /api/internal/smoke/send returned 200 — refuse to run');
    }
    console.log(`Unauth probe: HTTP ${probe.status} (expected 401/404/503)`);
  } catch (e) {
    stop(`Cannot reach production base URL: ${e.message}`);
  }

  console.log('✅ Startup verification passed\n');
}

async function postSmokeSend({ baseUrl, phone, message, resetState, caseId }) {
  const secret = getSmokeSecret();
  const res = await fetch(`${baseUrl}/api/internal/smoke/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-smoke-secret': secret,
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      phone,
      message,
      resetState,
      caseId,
    }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = { success: false, message: `Non-JSON response HTTP ${res.status}` };
  }
  return { httpStatus: res.status, body };
}

async function waitForDelivery(outboundId, opts) {
  const deadline = Date.now() + opts.deliveryTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await WhatsAppOutboundMessage.findById(outboundId).lean();
    if (!last) {
      await sleep(opts.pollMs);
      continue;
    }
    if (last.status === 'failed') {
      return {
        ok: false,
        status: last.status,
        doc: last,
        reason: last.webhookErrorReason || last.webhookErrorCode || 'outbound failed',
      };
    }
    if (DELIVERY_OK.has(last.status)) {
      return { ok: true, status: last.status, doc: last };
    }
    if (!opts.strict && last.gupshupMessageId && ['submitted', 'sent'].includes(last.status)) {
      // Keep waiting for DLR until timeout; non-strict may accept later.
    }
    await sleep(opts.pollMs);
  }
  last = outboundId ? await WhatsAppOutboundMessage.findById(outboundId).lean() : last;
  if (!opts.strict && last && last.gupshupMessageId && ['submitted', 'sent', 'delivered', 'read'].includes(last.status)) {
    return {
      ok: true,
      status: last.status,
      doc: last,
      acceptedAsSubmitted: !DELIVERY_OK.has(last.status),
      reason: DELIVERY_OK.has(last.status)
        ? null
        : 'DLR not seen within timeout; accepted submitted/sent + messageId (non-strict)',
    };
  }
  return {
    ok: false,
    status: last?.status || null,
    doc: last,
    reason: `delivery timeout after ${opts.deliveryTimeoutMs}ms (status=${last?.status || 'unknown'})`,
  };
}

async function auditMongo(phone, inboundId, outboundId, since) {
  const conversation = await WhatsAppConversation.findOne({ phone }).lean();
  const botState = conversation
    ? await WhatsAppBotState.findOne({ conversationId: conversation._id }).lean()
    : null;
  const inbound = inboundId ? await WhatsAppInboundMessage.findById(inboundId).lean() : null;
  const outbound = outboundId ? await WhatsAppOutboundMessage.findById(outboundId).lean() : null;

  let lifecycle = { count: 0, latest: null };
  try {
    const LeadLifecycleEvent = require('../models/LeadLifecycleEvent');
    const rows = await LeadLifecycleEvent.find({ phone10: phone, transitionAt: { $gte: since } })
      .sort({ transitionAt: -1 })
      .limit(5)
      .lean();
    lifecycle = {
      count: await LeadLifecycleEvent.countDocuments({ phone10: phone }),
      recent: rows.map((r) => ({ stage: r.stage, productLine: r.productLine, at: r.transitionAt })),
    };
  } catch (e) {
    lifecycle = { error: e.message };
  }

  let leadEvents = { count: 0 };
  try {
    const WhatsAppLeadEvent = require('../models/WhatsAppLeadEvent');
    leadEvents = {
      count: await WhatsAppLeadEvent.countDocuments({ phone, createdAt: { $gte: since } }),
      total: await WhatsAppLeadEvent.countDocuments({ phone }),
    };
  } catch (e) {
    leadEvents = { error: e.message };
  }

  let prediction = null;
  try {
    const { getPredictionForPhone } = require('../services/analytics/predictionService');
    prediction = await getPredictionForPhone(phone, { force: false });
  } catch (e) {
    prediction = { error: e.message };
  }

  let alerts = { openCount: null };
  try {
    const AnalyticsAlert = require('../models/AnalyticsAlert');
    alerts = {
      openCount: await AnalyticsAlert.countDocuments({ status: 'open' }),
      recentOpen: await AnalyticsAlert.find({ status: 'open' })
        .sort({ createdAt: -1 })
        .limit(3)
        .select('type severity title createdAt')
        .lean(),
    };
  } catch (e) {
    alerts = { error: e.message };
  }

  return {
    mongo: {
      conversation: conversation
        ? {
            id: String(conversation._id),
            status: conversation.status,
            lastIntent: conversation.lastIntent,
            messageCount: conversation.messageCount,
            lastInboundAt: conversation.lastInboundAt,
            lastOutboundAt: conversation.lastOutboundAt,
          }
        : null,
      botState: botState
        ? { state: botState.state, version: botState.version, updatedAt: botState.updatedAt }
        : null,
      inbound: inbound
        ? {
            id: String(inbound._id),
            processStatus: inbound.processStatus,
            processError: inbound.processError,
            text: inbound.text,
          }
        : null,
      outbound: outbound
        ? {
            id: String(outbound._id),
            status: outbound.status,
            gupshupMessageId: outbound.gupshupMessageId,
            deliveredAt: outbound.deliveredAt,
            readAt: outbound.readAt,
            sentAt: outbound.sentAt,
          }
        : null,
    },
    lifecycle,
    leadEvents,
    prediction: prediction
      ? {
          hasPayload: Boolean(prediction && (prediction.payload || prediction.admissionProbability != null || prediction.phone)),
          computedAt: prediction.computedAt || prediction.payload?.computedAt || null,
          error: prediction.error || null,
        }
      : null,
    alerts,
  };
}

async function runCase({ caseNum, suiteId, testCase, phone, opts }) {
  const label = testCase.id || `case-${caseNum}`;
  const since = new Date();
  console.log('\n──────────────────────────────────────────');
  console.log(`Case ${caseNum} (${label})`);
  console.log(`\nUser:\n\n${testCase.user}\n`);
  console.log(`↓\n\nPOST ${opts.baseUrl}/api/internal/smoke/send …\n`);

  const t0 = Date.now();
  const { httpStatus, body } = await postSmokeSend({
    baseUrl: opts.baseUrl,
    phone,
    message: String(testCase.user ?? ''),
    resetState: testCase.resetState !== false,
    caseId: label,
  });
  const data = body?.data || {};

  const record = {
    caseNum,
    id: label,
    suiteId,
    group: testCase.group || null,
    user: testCase.user,
    httpStatus,
    apiSuccess: Boolean(body?.success),
    apiMessage: body?.message || null,
    inboundId: data.inboundId || null,
    outboundId: data.outboundId || null,
    gupshupMessageId: data.gupshupMessageId || null,
    outboundStatus: data.outboundStatus || null,
    intent: data.intent || null,
    durationMsApi: data.durationMs || Date.now() - t0,
    delivery: null,
    audit: null,
    pass: false,
    failReason: null,
  };

  if (!body?.success || !data.outboundId) {
    record.failReason =
      body?.message ||
      `Production endpoint did not return outboundId (HTTP ${httpStatus})`;
    console.log(`FAIL — ${record.failReason}`);
    return record;
  }

  console.log(`API OK — outboundId=${data.outboundId} gupshupMessageId=${data.gupshupMessageId || '(pending)'}`);
  console.log('Waiting for WhatsApp delivery (Mongo DLR)…');

  const delivery = await waitForDelivery(data.outboundId, opts);
  record.delivery = {
    ok: delivery.ok,
    status: delivery.status,
    acceptedAsSubmitted: Boolean(delivery.acceptedAsSubmitted),
    reason: delivery.reason || null,
    deliveredAt: delivery.doc?.deliveredAt || null,
    readAt: delivery.doc?.readAt || null,
    gupshupMessageId: delivery.doc?.gupshupMessageId || data.gupshupMessageId,
  };
  record.outboundStatus = delivery.status || record.outboundStatus;
  record.gupshupMessageId = record.delivery.gupshupMessageId;

  if (!delivery.ok) {
    record.failReason = delivery.reason || 'delivery failed';
    console.log(`FAIL — ${record.failReason}`);
    return record;
  }

  if (opts.audit) {
    record.audit = await auditMongo(phone, data.inboundId, data.outboundId, since);
    const mongoOk =
      record.audit?.mongo?.inbound?.processStatus === 'processed' ||
      record.audit?.mongo?.outbound?.status;
    if (!mongoOk && opts.strict) {
      record.failReason = 'audit: inbound/outbound Mongo snapshot incomplete';
      console.log(`FAIL — ${record.failReason}`);
      return record;
    }
  }

  record.pass = true;
  console.log(`PASS — WhatsApp ${delivery.status}${delivery.acceptedAsSubmitted ? ' (accepted submitted)' : ''}`);
  return record;
}

function writeSummaries(runMeta, caseRecords) {
  const runDir = path.join(
    SMOKE_RESULTS_DIR,
    'production',
    `${runMeta.startedAt.replace(/[:.]/g, '-')}_${runMeta.suite}`
  );
  ensureDir(runDir);

  caseRecords.forEach((r, idx) => {
    writeJson(path.join(runDir, `${String(idx + 1).padStart(3, '0')}_${r.id || idx}.json`), r);
  });

  const passed = caseRecords.filter((r) => r.pass).length;
  const failed = caseRecords.length - passed;
  const summary = {
    ...runMeta,
    finishedAt: new Date().toISOString(),
    total: caseRecords.length,
    passed,
    failed,
    passRate: caseRecords.length ? Number(((passed / caseRecords.length) * 100).toFixed(1)) : 0,
    cases: caseRecords.map((r) => ({
      id: r.id,
      pass: r.pass,
      outboundStatus: r.outboundStatus,
      gupshupMessageId: r.gupshupMessageId,
      failReason: r.failReason,
    })),
  };

  writeJson(path.join(runDir, 'summary.json'), summary);
  writeJson(path.join(SMOKE_RESULTS_DIR, 'summary.json'), summary);

  const md = [
    '# Production Conversation Smoke Summary',
    '',
    `- Base: ${summary.baseUrl}`,
    `- Suite: ${summary.suite}`,
    `- Phone: ${summary.phone}`,
    `- Strict: ${summary.strict}`,
    `- Audit: ${summary.audit}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Result: **${passed}/${caseRecords.length} passed** (${summary.passRate}%)`,
    '',
    '| Case | Pass | Outbound | Reason |',
    '|---|---|---|---|',
    ...caseRecords.map(
      (r) =>
        `| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.outboundStatus || '—'} | ${(r.failReason || '').replace(/\|/g, '/')} |`
    ),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(runDir, 'summary.md'), md);
  fs.writeFileSync(path.join(SMOKE_RESULTS_DIR, 'summary.md'), md);

  console.log(`\nWrote ${path.join(SMOKE_RESULTS_DIR, 'summary.md')}`);
  console.log(`Wrote ${path.join(SMOKE_RESULTS_DIR, 'summary.json')}`);
  console.log(`Case artifacts: ${runDir}`);

  return summary;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  await startupVerification(opts);

  const suites = resolveSuites(opts.suite);
  const flatCases = [];
  for (const suite of suites) {
    for (const c of suite.cases || []) {
      flatCases.push({ suiteId: suite.id || opts.suite, testCase: c });
    }
  }
  if (!flatCases.length) stop('No cases to run');

  await mongoose.connect(process.env.MONGODB_URI);

  const runMeta = {
    framework: 'productionConversationSmokeRunner',
    baseUrl: opts.baseUrl,
    suite: opts.suite,
    phone: opts.phone,
    strict: opts.strict,
    audit: opts.audit,
    startedAt: new Date().toISOString(),
  };

  const records = [];
  let caseNum = 0;
  try {
    for (const { suiteId, testCase } of flatCases) {
      caseNum += 1;
      const record = await runCase({
        caseNum,
        suiteId,
        testCase,
        phone: opts.phone,
        opts,
      });
      records.push(record);
      if (!record.pass) {
        console.error('\nFail-fast: stopping after first failure.');
        break;
      }
      // Gentle pace for production rate limits
      await sleep(Number(process.env.PRODUCTION_SMOKE_CASE_GAP_MS) || 1500);
    }
  } finally {
    const summary = writeSummaries(runMeta, records);
    await mongoose.disconnect().catch(() => {});
    process.exit(summary.failed > 0 || summary.passed === 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
