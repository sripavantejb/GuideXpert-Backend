#!/usr/bin/env node
'use strict';

/**
 * Production-grade REAL conversation smoke runner.
 *
 * Flow:
 *   Test message → processInbound() → … → whatsappOutboundService →
 *   gupshupSession.sendTextMessage() → Gupshup → Meta → phone
 *
 * NO mocks, NO test hooks, NO outbound capture, NO simulation.
 *
 * Usage:
 *   node scripts/realConversationSmokeRunner.js --phone=9347763131 --suite=sectionA
 *   node scripts/realConversationSmokeRunner.js --phone=9347763131 --suite=all
 *
 * Requires production Gupshup credentials in .env / .env.gupshup.local:
 *   ENABLE_WHATSAPP=true
 *   WA_INTEGRATION_STUB=0
 *   GUPSHUP_API_KEY=...
 *   GUPSHUP_SOURCE=...
 *   CHATBOT_SCOPE_FIREWALL_ENABLED=1
 *   CHATBOT_SCOPE_CLASSIFIER_ENABLED=1
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { performance } = require('perf_hooks');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');
const SMOKE_TESTS_DIR = path.join(ROOT, 'smoke-tests');
const SMOKE_RESULTS_DIR = path.join(ROOT, 'smoke-results');

// Load env the same way server.js does (shell exports preserved after override).
const shellEnv = {
  WA_INTEGRATION_STUB: process.env.WA_INTEGRATION_STUB,
  GUPSHUP_API_KEY: process.env.GUPSHUP_API_KEY,
  GUPSHUP_SOURCE: process.env.GUPSHUP_SOURCE,
  ENABLE_WHATSAPP: process.env.ENABLE_WHATSAPP,
  CHATBOT_SCOPE_FIREWALL_ENABLED: process.env.CHATBOT_SCOPE_FIREWALL_ENABLED,
  CHATBOT_SCOPE_CLASSIFIER_ENABLED: process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED,
  CHATBOT_SCOPE_ALLOW_LIST_FIRST: process.env.CHATBOT_SCOPE_ALLOW_LIST_FIRST,
  CHATBOT_SCOPE_FIREWALL_SHADOW_MODE: process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE,
};
require('dotenv').config({ path: path.join(ROOT, '.env') });
const gupshupLocal = path.join(ROOT, '.env.gupshup.local');
if (fs.existsSync(gupshupLocal)) {
  require('dotenv').config({ path: gupshupLocal, override: true });
}
for (const [key, value] of Object.entries(shellEnv)) {
  if (value !== undefined) process.env[key] = value;
}

const {
  getGupshupCredentialIssues,
  isIntegrationStubEnabled,
  isGupshupOutboundConfigured,
} = require('../utils/gupshupCredentialValidation');
const {
  isScopeFirewallEnabled,
  isScopeFirewallShadowMode,
  isAllowListFirstMode,
} = require('../services/chatbot/scopeFirewall/scopeFirewallFlags');
const gupshupSession = require('../services/chatbot/gupshupSessionService');
const whatsappOutbound = require('../services/chatbot/whatsappOutboundService');
const {
  processInbound,
  setChatbotOrchestratorTestHooks,
} = require('../services/chatbot/chatbotOrchestratorService');
const { getOrCreateConversation } = require('../services/chatbot/conversationService');
const { resetToMainMenu, getBotState } = require('../services/chatbot/botStateService');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const WhatsAppBotState = require('../models/WhatsAppBotState');

const DELIVERY_OK = new Set(['delivered', 'read']);
const SUBMITTED_OK = new Set(['submitted', 'sent', 'delivered', 'read']);

function parseArgs(argv) {
  const out = {
    phone: null,
    suite: 'sectionA',
    deliveryTimeoutMs: Number(process.env.REAL_SMOKE_DELIVERY_TIMEOUT_MS) || 90000,
    pollMs: Number(process.env.REAL_SMOKE_DELIVERY_POLL_MS) || 2000,
    acceptSubmitted: String(process.env.REAL_SMOKE_ACCEPT_SUBMITTED || '').trim() === '1',
  };
  for (const arg of argv) {
    if (arg.startsWith('--phone=')) out.phone = arg.slice('--phone='.length).replace(/\D/g, '').slice(-10);
    else if (arg.startsWith('--suite=')) out.suite = arg.slice('--suite='.length).trim();
    else if (arg.startsWith('--delivery-timeout-ms=')) {
      out.deliveryTimeoutMs = Number(arg.split('=')[1]) || out.deliveryTimeoutMs;
    } else if (arg === '--accept-submitted') out.acceptSubmitted = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function stop(reason) {
  console.error('\n⛔ STOP — real conversation smoke refused to execute');
  console.error(`Reason: ${reason}`);
  process.exit(1);
}

function envTruthyWhatsApp() {
  const v = String(process.env.ENABLE_WHATSAPP || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isClassifierEnabled() {
  return String(process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED || '').trim() === '1';
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
  if (!fs.existsSync(file)) {
    stop(`Suite file missing: smoke-tests/${suiteId}.json`);
  }
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

function sealTestHooks() {
  setChatbotOrchestratorTestHooks(null);
  const sealed = function refuseTestHooks() {
    stop('setChatbotOrchestratorTestHooks() was invoked — mocks/test hooks are forbidden');
  };
  // Replace export in module cache so accidental calls fail hard.
  const orchPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
  require.cache[orchPath].exports.setChatbotOrchestratorTestHooks = sealed;
}

function instrumentGupshupSession() {
  const state = {
    sendTextCalls: 0,
    sendButtonCalls: 0,
    sendListCalls: 0,
    lastResult: null,
    lastError: null,
  };
  const origText = gupshupSession.sendTextMessage.bind(gupshupSession);
  const origButton = gupshupSession.sendButtonMessage.bind(gupshupSession);
  const origList = gupshupSession.sendListMessage.bind(gupshupSession);

  gupshupSession.sendTextMessage = async (...args) => {
    state.sendTextCalls += 1;
    try {
      const result = await origText(...args);
      state.lastResult = result;
      return result;
    } catch (e) {
      state.lastError = e;
      throw e;
    }
  };
  gupshupSession.sendButtonMessage = async (...args) => {
    state.sendButtonCalls += 1;
    try {
      const result = await origButton(...args);
      state.lastResult = result;
      return result;
    } catch (e) {
      state.lastError = e;
      throw e;
    }
  };
  gupshupSession.sendListMessage = async (...args) => {
    state.sendListCalls += 1;
    try {
      const result = await origList(...args);
      state.lastResult = result;
      return result;
    } catch (e) {
      state.lastError = e;
      throw e;
    }
  };

  return state;
}

async function startupVerification(phone) {
  console.log('\n══════════════════════════════════════════');
  console.log(' REAL CONVERSATION SMOKE — STARTUP CHECK');
  console.log('══════════════════════════════════════════');

  const issues = [];

  if (!envTruthyWhatsApp()) issues.push('ENABLE_WHATSAPP is not true');
  if (isIntegrationStubEnabled()) issues.push('WA_INTEGRATION_STUB=1 (simulation forbidden)');
  for (const issue of getGupshupCredentialIssues()) issues.push(issue);
  if (!isGupshupOutboundConfigured()) issues.push('Gupshup outbound not configured');
  if (!isScopeFirewallEnabled()) issues.push('CHATBOT_SCOPE_FIREWALL_ENABLED must be 1');
  if (isScopeFirewallShadowMode()) {
    issues.push('CHATBOT_SCOPE_FIREWALL_SHADOW_MODE=1 (must enforce, not shadow)');
  }
  if (!isAllowListFirstMode()) {
    issues.push('Allow-list-first disabled (CHATBOT_SCOPE_ALLOW_LIST_FIRST=0)');
  }
  if (!isClassifierEnabled()) {
    issues.push('CHATBOT_SCOPE_CLASSIFIER_ENABLED must be 1');
  }
  if (typeof whatsappOutbound.sendBotTextReply !== 'function') {
    issues.push('whatsappOutboundService.sendBotTextReply missing');
  }
  if (typeof gupshupSession.sendTextMessage !== 'function') {
    issues.push('gupshupSession.sendTextMessage missing');
  }
  if (typeof gupshupSession.sendSessionMessageRaw !== 'function') {
    issues.push('gupshupSession.sendSessionMessageRaw missing');
  }
  if (!process.env.MONGODB_URI) issues.push('MONGODB_URI missing');
  if (!phone || phone.length !== 10) issues.push('Valid --phone=XXXXXXXXXX required');

  try {
    await dns.lookup('api.gupshup.io');
  } catch (e) {
    issues.push(`Session API host not reachable (DNS api.gupshup.io): ${e.message}`);
  }

  const report = {
    Outbound_Mode: 'REAL_whatsappOutboundService (defaultHooks)',
    Test_Hooks: 'sealed_null',
    Gupshup_Enabled: isGupshupOutboundConfigured() && !isIntegrationStubEnabled(),
    WhatsApp_Enabled: envTruthyWhatsApp(),
    Webhook_Enabled: 'n/a_for_outbound_path (synthetic inbound; real Gupshup session outbound)',
    Session_API: gupshupSession.GUPSHUP_SESSION_URL,
    Phone_Number: phone,
    Firewall_Enabled: isScopeFirewallEnabled(),
    Allow_List_Enabled: isAllowListFirstMode(),
    Classifier_Enabled: isClassifierEnabled(),
    Shadow_Mode: isScopeFirewallShadowMode(),
  };
  console.log(JSON.stringify(report, null, 2));

  if (issues.length) {
    stop(issues.join('; '));
  }

  console.log('✅ Startup verification passed\n');
}

async function countLeads(phone) {
  const counts = { iit: 0, form: 0, oneOnOne: 0 };
  try {
    const IIT = require('../models/IITCounsellingSubmission');
    counts.iit = await IIT.countDocuments({
      $or: [{ mobileNumber: phone }, { phone }, { whatsappNumber: phone }],
    });
  } catch (_) {}
  try {
    const Form = require('../models/FormSubmission');
    counts.form = await Form.countDocuments({
      $or: [{ mobileNumber: phone }, { phone }, { whatsappNumber: phone }],
    });
  } catch (_) {}
  try {
    const O = require('../models/OneOnOneCounselingLead');
    counts.oneOnOne = await O.countDocuments({ mobileNumber: phone });
  } catch (_) {}
  return counts;
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
      return { ok: false, status: last.status, doc: last, reason: last.webhookErrorReason || 'outbound failed' };
    }
    if (DELIVERY_OK.has(last.status)) {
      return { ok: true, status: last.status, doc: last };
    }
    if (opts.acceptSubmitted && SUBMITTED_OK.has(last.status) && last.gupshupMessageId) {
      // Still wait a bit for DLR; if none by deadline we accept submitted below.
    }
    await sleep(opts.pollMs);
  }
  last = outboundId ? await WhatsAppOutboundMessage.findById(outboundId).lean() : last;
  if (opts.acceptSubmitted && last && SUBMITTED_OK.has(last.status) && last.gupshupMessageId) {
    return {
      ok: true,
      status: last.status,
      doc: last,
      acceptedAsSubmitted: true,
      reason: 'DLR not seen within timeout; accepted submitted+messageId',
    };
  }
  return {
    ok: false,
    status: last?.status || null,
    doc: last,
    reason: `delivery timeout after ${opts.deliveryTimeoutMs}ms (status=${last?.status || 'unknown'})`,
  };
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

async function runCase({
  caseNum,
  suiteId,
  testCase,
  phone,
  session,
  gupshupProbe,
  opts,
  leadCountsBefore,
}) {
  const label = testCase.id || `case-${caseNum}`;
  console.log('\n──────────────────────────────────────────');
  console.log(`Case ${caseNum}`);
  console.log(`\nUser:\n\n${testCase.user}\n`);
  console.log('↓\n\nProcessing...\n');

  if (testCase.resetState !== false) {
    await resetToMainMenu(session.conversation._id, phone, { reason: 'real_smoke_reset' });
    await WhatsAppConversation.updateOne(
      { _id: session.conversation._id },
      { $set: { status: 'active', currentHandoffId: null } }
    );
    session.conversation = await WhatsAppConversation.findById(session.conversation._id);
  }

  const inbound = {
    _id: new mongoose.Types.ObjectId(),
    messageType: 'text',
    text: String(testCase.user ?? ''),
    interactivePayload: null,
    receivedAt: new Date(),
  };

  const gCallsBefore = {
    text: gupshupProbe.sendTextCalls,
    button: gupshupProbe.sendButtonCalls,
    list: gupshupProbe.sendListCalls,
  };

  const t0 = performance.now();
  let processResult = null;
  let processError = null;
  try {
    processResult = await processInbound({
      conversation: session.conversation,
      inbound,
      leadLinks: session.leadLinks,
    });
  } catch (e) {
    processError = e;
  }
  const processingMs = Math.round(performance.now() - t0);

  if (processError) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      error: `processInbound crashed: ${processError.message}`,
      gupshupProbe,
      leadCountsBefore,
    });
  }

  const botState = await getBotState(session.conversation._id);
  const intentGuess = classifyIntent(
    inbound.text,
    botState || { state: 'idle', context: {} },
    session.leadLinks?.productLine || session.conversation.productLine || 'unknown'
  );

  console.log('↓\n\nIntent\n');
  console.log(`  ${intentGuess.intent}${intentGuess.intentReason ? ` (${intentGuess.intentReason})` : ''}`);
  console.log('\n↓\n\nScope\n');
  console.log('  (evaluated inside processInbound / firewall)');
  console.log('\n↓\n\nJourney\n');
  console.log(`  botState=${botState?.state || 'unknown'}`);
  console.log('\n↓\n\nRAG / LLM\n');
  console.log('  (if selected by intent)');
  console.log('\n↓\n\nOutbound\n');

  const outboundId = processResult?.outboundId || null;
  let outboundDoc = outboundId ? await WhatsAppOutboundMessage.findById(outboundId).lean() : null;
  if (!outboundDoc && inbound._id) {
    outboundDoc = await WhatsAppOutboundMessage.findOne({ inReplyToInboundId: inbound._id })
      .sort({ createdAt: -1 })
      .lean();
  }

  const gCallsDelta = {
    text: gupshupProbe.sendTextCalls - gCallsBefore.text,
    button: gupshupProbe.sendButtonCalls - gCallsBefore.button,
    list: gupshupProbe.sendListCalls - gCallsBefore.list,
  };
  const gupshupCalled = gCallsDelta.text + gCallsDelta.button + gCallsDelta.list > 0;

  if (!gupshupCalled) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      intentGuess,
      botState,
      outboundDoc,
      processResult,
      error: 'Gupshup session send was NOT called (outbound may be mocked/bypassed/failed before HTTP)',
      gupshupProbe,
      leadCountsBefore,
    });
  }

  if (processResult && processResult.outboundSuccess === false) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      intentGuess,
      botState,
      outboundDoc,
      processResult,
      error: `WhatsApp send failed: ${processResult.error || 'outboundSuccess=false'}`,
      gupshupProbe,
      leadCountsBefore,
    });
  }

  const lastG = gupshupProbe.lastResult;
  if (lastG && lastG.success === false) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      intentGuess,
      botState,
      outboundDoc,
      processResult,
      error: `Gupshup API error: ${lastG.error || 'unknown'}`,
      gupshupProbe,
      leadCountsBefore,
      gupshupResult: lastG,
    });
  }

  const messageId =
    outboundDoc?.gupshupMessageId ||
    outboundDoc?.whatsappWaMessageId ||
    (lastG && lastG.data && (lastG.data.messageId || lastG.data.id)) ||
    null;

  if (!messageId) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      intentGuess,
      botState,
      outboundDoc,
      processResult,
      error: 'No Gupshup/WhatsApp message ID returned',
      gupshupProbe,
      leadCountsBefore,
      gupshupResult: lastG,
    });
  }

  console.log(`  messageId=${messageId}`);
  console.log(`  outboundStatus=${outboundDoc?.status || 'unknown'}`);
  console.log('\n↓\n\nWaiting for delivery...\n');

  const delivery = await waitForDelivery(outboundDoc?._id || outboundId, opts);
  if (!delivery.ok) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      intentGuess,
      botState,
      outboundDoc: delivery.doc || outboundDoc,
      processResult,
      error: delivery.reason,
      gupshupProbe,
      leadCountsBefore,
      gupshupResult: lastG,
      messageId,
    });
  }

  console.log(`↓\n\nDelivered (${delivery.status}${delivery.acceptedAsSubmitted ? ', accepted-submitted' : ''})\n`);

  const leadCountsAfter = await countLeads(phone);
  const duplicateLeads =
    leadCountsAfter.iit > leadCountsBefore.iit ||
    leadCountsAfter.form > leadCountsBefore.form ||
    leadCountsAfter.oneOnOne > leadCountsBefore.oneOnOne;

  if (duplicateLeads) {
    return failCase({
      caseNum,
      suiteId,
      testCase,
      phone,
      processingMs,
      intentGuess,
      botState,
      outboundDoc: delivery.doc || outboundDoc,
      processResult,
      error: `Duplicate lead creation detected: before=${JSON.stringify(leadCountsBefore)} after=${JSON.stringify(leadCountsAfter)}`,
      gupshupProbe,
      leadCountsBefore,
      leadCountsAfter,
      messageId,
      delivery,
    });
  }

  session.conversation = await WhatsAppConversation.findById(session.conversation._id);
  const freshState = await getBotState(session.conversation._id);

  const record = {
    caseNumber: caseNum,
    caseId: label,
    suite: suiteId,
    group: testCase.group || null,
    userMessage: testCase.user,
    botResponse: (delivery.doc || outboundDoc)?.textPreview || null,
    intent: intentGuess.intent,
    intentReason: intentGuess.intentReason || null,
    scope: 'evaluated_in_processInbound',
    journey: freshState?.state || null,
    knowledgeSource: null,
    latencyMs: processingMs,
    messageId,
    outboundId: String((delivery.doc || outboundDoc)?._id || ''),
    deliveryStatus: delivery.status,
    gupshupCalls: gCallsDelta,
    gupshupSuccess: Boolean(lastG && lastG.success !== false),
    database: {
      conversationId: String(session.conversation._id),
      botState: freshState?.state || null,
      leadCountsBefore,
      leadCountsAfter,
      duplicateLeads: false,
    },
    analytics: { note: 'inbound_processed structured logs emitted by orchestrator' },
    prediction: null,
    alerts: null,
    errors: [],
    status: 'PASS',
    finishedAt: new Date().toISOString(),
  };

  console.log('↓\n\nPASS\n');
  return { ok: true, record };
}

async function failCase(ctx) {
  console.error(`\n↓\n\nFAIL — ${ctx.error}\n`);
  const record = {
    caseNumber: ctx.caseNum,
    caseId: ctx.testCase?.id || null,
    suite: ctx.suiteId,
    group: ctx.testCase?.group || null,
    userMessage: ctx.testCase?.user,
    botResponse: ctx.outboundDoc?.textPreview || null,
    intent: ctx.intentGuess?.intent || null,
    intentReason: ctx.intentGuess?.intentReason || null,
    journey: ctx.botState?.state || null,
    latencyMs: ctx.processingMs,
    messageId: ctx.messageId || ctx.outboundDoc?.gupshupMessageId || null,
    deliveryStatus: ctx.delivery?.status || ctx.outboundDoc?.status || null,
    gupshupResult: ctx.gupshupResult || ctx.gupshupProbe?.lastResult || null,
    database: {
      leadCountsBefore: ctx.leadCountsBefore || null,
      leadCountsAfter: ctx.leadCountsAfter || null,
    },
    errors: [ctx.error],
    status: 'FAIL',
    finishedAt: new Date().toISOString(),
  };
  return { ok: false, record, stopReason: ctx.error };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage:
  node scripts/realConversationSmokeRunner.js --phone=9347763131 --suite=sectionA
  node scripts/realConversationSmokeRunner.js --phone=9347763131 --suite=all

Options:
  --delivery-timeout-ms=90000
  --accept-submitted          accept Gupshup submitted+messageId if DLR late
Env:
  REAL_SMOKE_DELIVERY_TIMEOUT_MS
  REAL_SMOKE_ACCEPT_SUBMITTED=1
`);
    process.exit(0);
  }

  sealTestHooks();
  await startupVerification(opts.phone);

  const suites = resolveSuites(opts.suite);
  const nonEmpty = suites.filter((s) => Array.isArray(s.cases) && s.cases.length > 0);
  if (!nonEmpty.length) {
    stop(`No cases to run for suite="${opts.suite}"`);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Production Mongo connected');

  const gupshupProbe = instrumentGupshupSession();

  // Confirm outbound module is the real one (not a stub object).
  if (whatsappOutbound.sendBotTextReply.toString().includes('status: \'simulated\'')) {
    stop('whatsappOutboundService appears stubbed');
  }

  let session = await getOrCreateConversation(opts.phone);
  console.log('Conversation:', String(session.conversation._id), 'productLine=', session.leadLinks?.productLine);

  const leadCountsStart = await countLeads(opts.phone);
  const summary = {
    phone: opts.phone,
    startedAt: new Date().toISOString(),
    mode: 'real_whatsapp_outbound',
    suites: [],
    totals: {
      cases: 0,
      passed: 0,
      failed: 0,
      deliverySuccess: 0,
      latencySumMs: 0,
      databaseWrites: 0,
      alerts: 0,
      predictions: 0,
      duplicateLeads: 0,
      duplicateEvents: 0,
      conversationErrors: 0,
    },
    leadCountsStart,
  };

  let caseNum = 0;
  let stopped = false;
  let stopReason = null;

  for (const suite of nonEmpty) {
    const suiteDir = path.join(SMOKE_RESULTS_DIR, suite.id || 'suite');
    ensureDir(suiteDir);
    const suiteResult = { id: suite.id, title: suite.title, cases: [], status: 'PASS' };

    for (const testCase of suite.cases) {
      caseNum += 1;
      summary.totals.cases += 1;
      const leadCountsBefore = await countLeads(opts.phone);

      const { ok, record, stopReason: reason } = await runCase({
        caseNum,
        suiteId: suite.id,
        testCase,
        phone: opts.phone,
        session,
        gupshupProbe,
        opts,
        leadCountsBefore,
      });

      const fileName = String(caseNum).padStart(3, '0') + '.json';
      writeJson(path.join(suiteDir, fileName), record);
      suiteResult.cases.push(record);

      summary.totals.latencySumMs += record.latencyMs || 0;
      summary.totals.databaseWrites += 1;

      if (ok) {
        summary.totals.passed += 1;
        summary.totals.deliverySuccess += 1;
      } else {
        summary.totals.failed += 1;
        summary.totals.conversationErrors += 1;
        suiteResult.status = 'FAIL';
        stopped = true;
        stopReason = reason;
        break;
      }
    }

    summary.suites.push(suiteResult);
    if (stopped) break;
  }

  const leadCountsEnd = await countLeads(opts.phone);
  summary.leadCountsEnd = leadCountsEnd;
  if (
    leadCountsEnd.iit > leadCountsStart.iit ||
    leadCountsEnd.form > leadCountsStart.form ||
    leadCountsEnd.oneOnOne > leadCountsStart.oneOnOne
  ) {
    summary.totals.duplicateLeads += 1;
  }

  summary.finishedAt = new Date().toISOString();
  summary.totals.avgLatencyMs =
    summary.totals.cases > 0 ? Math.round(summary.totals.latencySumMs / summary.totals.cases) : 0;
  summary.totals.deliverySuccessPct =
    summary.totals.cases > 0
      ? Number(((summary.totals.deliverySuccess / summary.totals.cases) * 100).toFixed(2))
      : 0;
  summary.totals.avgProcessingMs = summary.totals.avgLatencyMs;
  summary.totals.avgResponseTimeMs = summary.totals.avgLatencyMs;

  const productionReady =
    !stopped &&
    summary.totals.failed === 0 &&
    summary.totals.cases > 0 &&
    summary.totals.deliverySuccess === summary.totals.cases &&
    summary.totals.duplicateLeads === 0 &&
    summary.totals.duplicateEvents === 0;

  summary.productionReady = productionReady;
  summary.productionReadiness = productionReady ? 'PASS' : 'FAIL';
  summary.stopReason = stopReason;

  const resultRoot = path.join(SMOKE_RESULTS_DIR, nonEmpty.length === 1 ? nonEmpty[0].id : 'all');
  ensureDir(resultRoot);
  writeJson(path.join(resultRoot, 'summary.json'), summary);

  const md = [
    `# Real Conversation Smoke — ${summary.productionReadiness}`,
    '',
    `- Phone: ${summary.phone}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Cases: ${summary.totals.cases}`,
    `- Passed: ${summary.totals.passed}`,
    `- Failed: ${summary.totals.failed}`,
    `- Delivery success: ${summary.totals.deliverySuccessPct}%`,
    `- Avg latency: ${summary.totals.avgLatencyMs}ms`,
    `- Duplicate leads: ${summary.totals.duplicateLeads}`,
    `- Production readiness: **${summary.productionReadiness}**`,
    stopReason ? `- Stop reason: ${stopReason}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  fs.writeFileSync(path.join(resultRoot, 'summary.md'), md);

  console.log('\n══════════════════════════════════════════');
  console.log(' FINAL SUMMARY');
  console.log('══════════════════════════════════════════');
  console.log(`Total Cases:              ${summary.totals.cases}`);
  console.log(`Passed:                   ${summary.totals.passed}`);
  console.log(`Failed:                   ${summary.totals.failed}`);
  console.log(`Delivery Success %:       ${summary.totals.deliverySuccessPct}`);
  console.log(`Average Latency:          ${summary.totals.avgLatencyMs}ms`);
  console.log(`Average Response Time:    ${summary.totals.avgResponseTimeMs}ms`);
  console.log(`Average Processing Time:  ${summary.totals.avgProcessingMs}ms`);
  console.log(`Total Database Writes:    ${summary.totals.databaseWrites}`);
  console.log(`Total Alerts:             ${summary.totals.alerts}`);
  console.log(`Total Predictions:        ${summary.totals.predictions}`);
  console.log(`Duplicate Leads:          ${summary.totals.duplicateLeads}`);
  console.log(`Duplicate Events:         ${summary.totals.duplicateEvents}`);
  console.log(`Conversation Errors:      ${summary.totals.conversationErrors}`);
  console.log(`Production Readiness:     ${summary.productionReadiness}`);
  console.log(`Results:                  ${resultRoot}`);

  await mongoose.disconnect();
  process.exit(productionReady ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
