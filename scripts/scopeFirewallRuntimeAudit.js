'use strict';

/**
 * Phase 4.5 runtime audit — drives real processInbound() with shadow-mode
 * firewall enabled and captures structured log events.
 *
 * Usage: node scripts/scopeFirewallRuntimeAudit.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const axios = require('axios');

process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = process.env.CHATBOT_SCOPE_FIREWALL_ENABLED || '1';
process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE = process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE || '1';
process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '1';
process.env.LLM_API_KEY = process.env.LLM_API_KEY || 'audit-mock-key';

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const knowledgeAssistantPath = require.resolve('../services/chatbot/knowledgeAssistantService');
const llmReplyPath = require.resolve('../services/chatbot/llmReplyService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();
const PORT = process.env.PORT || 5000;

const structuredEvents = [];
let answerCalls = 0;
let outboundCalls = [];
let originalConsoleInfo;

function captureStructuredLogs() {
  originalConsoleInfo = console.info;
  console.info = (...args) => {
    const line = args.join(' ');
    if (line.includes('[chatbot:structured]')) {
      const jsonStart = line.indexOf('{');
      if (jsonStart >= 0) {
        try {
          structuredEvents.push(JSON.parse(line.slice(jsonStart)));
        } catch (_e) {
          // ignore
        }
      }
    }
  };
}

function restoreConsole() {
  if (originalConsoleInfo) console.info = originalConsoleInfo;
}

function loadOrchestrator() {
  delete require.cache[orchestratorPath];
  delete require.cache[knowledgeAssistantPath];
  delete require.cache[llmReplyPath];

  const ka = require(knowledgeAssistantPath);
  const originalAnswer = ka.answerWithTimeout;
  ka.answerWithTimeout = async (...args) => {
    answerCalls += 1;
    return { text: '[AUDIT MOCK LLM REPLY]', model: 'audit-mock' };
  };

  require(llmReplyPath);
  return require(orchestratorPath);
}

function applyHooks(orchestrator, { knowledgeAssistantActive = false } = {}) {
  orchestrator.setChatbotOrchestratorTestHooks({
    buildLeadContext: async () => ({ productLine: 'unknown' }),
    retrieveFacts: async () => ({ links: [] }),
    getBotState: async () => ({
      state: 'idle',
      context: knowledgeAssistantActive ? { knowledgeAssistantActive: true } : {},
    }),
    transitionState: async () => {},
    isBotPausedForConversation: async () => false,
    createHandoff: async () => {},
    cancelActiveHandoffForUser: async () => {},
    updateConversationIntent: async () => {},
    outbound: {
      sendBotTextReply: async (args) => {
        outboundCalls.push(args);
        return { success: true };
      },
    },
  });
}

async function sendMessage(orchestrator, text, { knowledgeAssistantActive = false } = {}) {
  structuredEvents.length = 0;
  answerCalls = 0;
  outboundCalls = [];

  applyHooks(orchestrator, { knowledgeAssistantActive });

  await orchestrator.processInbound({
    conversation: {
      _id: CONVERSATION_ID,
      phone: '9876543210',
      productLine: 'unknown',
      status: 'active',
    },
    inbound: { _id: INBOUND_ID, text, messageType: 'text' },
    leadLinks: [],
  });

  const scopeEvent = structuredEvents.find(
    (e) =>
      e.event === 'scope_blocked_shadow' ||
      e.event === 'scope_blocked' ||
      e.event === 'scope_allowed'
  );

  return {
    text,
    scopeEvent,
    answerCalls,
    outboundText: outboundCalls[0]?.text || null,
    allEvents: structuredEvents.map((e) => e.event),
  };
}

function assertCase(label, result, expected) {
  const issues = [];
  if (expected.event && result.scopeEvent?.event !== expected.event) {
    issues.push(`expected event ${expected.event}, got ${result.scopeEvent?.event || 'none'}`);
  }
  if (expected.category && result.scopeEvent?.scopeCategory !== expected.category) {
    issues.push(
      `expected category ${expected.category}, got ${result.scopeEvent?.scopeCategory || 'none'}`
    );
  }
  if (expected.reason && !result.scopeEvent?.scopeReason) {
    issues.push('scopeReason not populated');
  }
  if (expected.llmCalled === true && result.answerCalls < 1) {
    issues.push('expected LLM call in shadow mode, none occurred');
  }
  if (expected.llmCalled === false && result.answerCalls > 0) {
    issues.push('expected no LLM call, but LLM was invoked');
  }
  if (expected.noShadowBlock && result.scopeEvent?.event === 'scope_blocked_shadow') {
    issues.push('unexpected scope_blocked_shadow (false positive)');
  }
  if (expected.allowedOverride && result.scopeEvent?.event !== 'scope_allowed') {
    issues.push(`expected scope_allowed for mixed message, got ${result.scopeEvent?.event}`);
  }

  const pass = issues.length === 0;
  return { label, pass, issues, result };
}

async function checkHealth() {
  try {
    const res = await axios.get(`http://localhost:${PORT}/api/health`, { timeout: 5000 });
    return res.data?.scopeFirewall || null;
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log('=== Phase 4.5 Scope Firewall Runtime Audit ===\n');

  const health = await checkHealth();
  console.log('Step 1 — Health (/api/health):');
  console.log(JSON.stringify(health, null, 2));

  captureStructuredLogs();
  const orchestrator = loadOrchestrator();

  const cases = [
    {
      label: 'Step 2a — Write Python code for sorting',
      text: 'Write Python code for sorting',
      expected: { event: 'scope_blocked_shadow', category: 'programming', reason: true, llmCalled: true },
    },
    {
      label: 'Step 2b — Give JavaScript calculator code',
      text: 'Give JavaScript calculator code',
      expected: { event: 'scope_blocked_shadow', category: 'programming', reason: true, llmCalled: true },
    },
    {
      label: 'Step 2c — Explain binary tree traversal',
      text: 'Explain binary tree traversal',
      expected: { event: 'scope_blocked_shadow', category: 'programming', reason: true, llmCalled: true },
    },
    {
      label: 'Step 3 — Generate an image of a dog',
      text: 'Generate an image of a dog',
      expected: { event: 'scope_blocked_shadow', category: 'image_generation', reason: true, llmCalled: true },
    },
    {
      label: 'Step 4 — Tell me about Avengers movie',
      text: 'Tell me about Avengers movie',
      expected: { event: 'scope_blocked_shadow', category: 'movies', reason: true, llmCalled: true },
    },
    {
      label: 'Step 5 — What is the weather today?',
      text: 'What is the weather today?',
      expected: { event: 'scope_blocked_shadow', category: 'weather', reason: true, llmCalled: true },
    },
    {
      label: 'Step 6 — Should I invest in bitcoin?',
      text: 'Should I invest in bitcoin?',
      expected: { event: 'scope_blocked_shadow', category: 'finance', reason: true, llmCalled: true },
    },
    {
      label: 'Step 7a — Which branch is good for me?',
      text: 'Which branch is good for me?',
      expected: { event: 'scope_allowed', noShadowBlock: true },
    },
    {
      label: 'Step 7b — What is JoSAA?',
      text: 'What is JoSAA?',
      expected: { event: 'scope_allowed', noShadowBlock: true },
    },
    {
      label: 'Step 7c — Can I get CSE in IIT Hyderabad with rank 3500?',
      text: 'Can I get CSE in IIT Hyderabad with rank 3500?',
      expected: { event: 'scope_allowed', noShadowBlock: true },
    },
    {
      label: 'Step 7d — Should I float or freeze?',
      text: 'Should I float or freeze?',
      expected: { event: 'scope_allowed', noShadowBlock: true },
    },
    {
      label: 'Step 7e — What are hostel fees?',
      text: 'What are hostel fees?',
      expected: { event: 'scope_allowed', noShadowBlock: true },
    },
    {
      label: 'Step 9 — Mixed message (Python + IIT CSE)',
      text: 'I like Python but I want CSE in IIT Hyderabad',
      expected: { event: 'scope_allowed', allowedOverride: true, noShadowBlock: true },
    },
  ];

  const results = [];
  for (const c of cases) {
    const result = await sendMessage(orchestrator, c.text);
    results.push(assertCase(c.label, result, c.expected));
  }

  // Step 8 — sticky session
  await sendMessage(orchestrator, 'Which branch is good for me?');
  const stickyResult = await sendMessage(orchestrator, 'Write Python code for sorting', {
    knowledgeAssistantActive: true,
  });
  results.push(
    assertCase('Step 8 — Sticky KA + programming', stickyResult, {
      event: 'scope_blocked_shadow',
      category: 'programming',
      reason: true,
      llmCalled: true,
    })
  );

  orchestrator.setChatbotOrchestratorTestHooks(null);
  restoreConsole();

  // Step 10 — statistics
  let allowed = 0;
  let blockedShadow = 0;
  for (const r of results) {
    const ev = r.result.scopeEvent?.event;
    if (ev === 'scope_allowed') allowed += 1;
    if (ev === 'scope_blocked_shadow') blockedShadow += 1;
  }
  const total = results.length;
  const pctAllowed = ((allowed / total) * 100).toFixed(1);
  const pctBlocked = ((blockedShadow / total) * 100).toFixed(1);

  console.log('\n--- Test Results ---\n');
  let passCount = 0;
  let failCount = 0;
  const falsePositives = [];
  const falseNegatives = [];

  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    if (r.pass) passCount += 1;
    else failCount += 1;

    console.log(`${status}  ${r.label}`);
    if (r.result.scopeEvent) {
      console.log(
        `       event=${r.result.scopeEvent.event} category=${r.result.scopeEvent.scopeCategory || '-'} reason=${r.result.scopeEvent.scopeReason || '-'} llmCalls=${r.result.answerCalls}`
      );
    } else {
      console.log('       (no scope event captured)');
    }
    if (!r.pass) {
      console.log(`       issues: ${r.issues.join('; ')}`);
    }

    if (r.label.startsWith('Step 7') || r.label.startsWith('Step 9')) {
      if (r.result.scopeEvent?.event === 'scope_blocked_shadow') {
        falsePositives.push(r.label);
      }
    }
    if (
      r.label.match(/^Step [2-6]|Step 8/) &&
      r.result.scopeEvent?.event !== 'scope_blocked_shadow'
    ) {
      falseNegatives.push(r.label);
    }
  }

  console.log('\n--- Step 10 Statistics ---\n');
  console.log(`Total cases: ${total}`);
  console.log(`scope_allowed: ${allowed} (${pctAllowed}%)`);
  console.log(`scope_blocked_shadow: ${blockedShadow} (${pctBlocked}%)`);
  console.log(`Passed: ${passCount}/${total}`);
  console.log(`Failed: ${failCount}/${total}`);
  console.log(`False positives: ${falsePositives.length ? falsePositives.join(', ') : 'none'}`);
  console.log(`False negatives: ${falseNegatives.length ? falseNegatives.join(', ') : 'none'}`);

  console.log('\n--- Step 11 Recommendation ---\n');
  const healthOk =
    health &&
    health.enabled === true &&
    health.shadowMode === true &&
    health.ready === true;

  if (healthOk && failCount === 0 && falsePositives.length === 0 && falseNegatives.length === 0) {
    console.log(
      'READY FOR ENFORCEMENT: No false positives/negatives in runtime audit.\n' +
        'Recommend setting CHATBOT_SCOPE_FIREWALL_SHADOW_MODE=0 after monitoring production logs.'
    );
  } else {
    console.log('REMAIN IN SHADOW MODE:');
    if (!healthOk) console.log('- Health check did not show enabled=true, shadowMode=true, ready=true');
    if (failCount) console.log(`- ${failCount} runtime case(s) failed`);
    if (falsePositives.length) console.log(`- False positives: ${falsePositives.join(', ')}`);
    if (falseNegatives.length) console.log(`- False negatives: ${falseNegatives.join(', ')}`);
  }

  process.exit(failCount > 0 || !healthOk ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
