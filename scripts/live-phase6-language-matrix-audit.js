#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { LANGUAGE_MATRIX } = require('../constants/languageMatrixProbes');
const { assertReplyLanguage } = require('../utils/replyLanguageVerifier');

const structuredLogPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');

const capturedStructuredLogs = [];
const structuredLog = require(structuredLogPath);
const originalLogChatbotEvent = structuredLog.logChatbotEvent;
structuredLog.logChatbotEvent = function captureLogChatbotEvent(event, fields = {}) {
  capturedStructuredLogs.push({ event, fields: { ...fields } });
  return originalLogChatbotEvent.call(this, event, fields);
};

const SCENARIOS = ['greeting', 'branch', 'rank', 'unknown'];

function extractLogPayload() {
  const entries = capturedStructuredLogs.filter((row) => row.event === 'inbound_processed');
  return entries.length ? entries[entries.length - 1].fields : null;
}

async function runProbe(orchestrator, langRow, scenario) {
  const outboundMessages = [];
  const conversationId = new mongoose.Types.ObjectId();
  const inboundId = new mongoose.Types.ObjectId();
  const input = langRow[scenario];

  orchestrator.setChatbotOrchestratorTestHooks({
    buildLeadContext: async () => ({
      productLine: 'iit_counselling',
      hasIit: true,
      iit: {
        fullName: 'Test Student',
        slotBooking: 'Slot A',
        slotInstantLabel: 'Mon 10:00 IST',
        preferredLanguage: 'Telugu',
        assignedBdaName: 'Counsellor',
        demoStatusLabel: 'Scheduled',
      },
      phone: '9876543210',
    }),
    retrieveFacts: async () => ({ links: [] }),
    getBotState: async () => ({ state: 'idle', context: {} }),
    transitionState: async () => {},
    isBotPausedForConversation: async () => false,
    createHandoff: async () => {},
    cancelActiveHandoffForUser: async () => {},
    updateConversationIntent: async () => {},
    outbound: {
      sendBotTextReply: async (args) => {
        outboundMessages.push(args.text);
        return { success: true };
      },
    },
  });

  try {
    await orchestrator.processInbound({
      conversation: {
        _id: conversationId,
        phone: '9876543210',
        productLine: 'iit_counselling',
        status: 'active',
        preferredLanguage: 'te',
      },
      inbound: {
        _id: inboundId,
        text: input,
        messageType: 'text',
      },
      leadLinks: [],
    });
  } finally {
    orchestrator.setChatbotOrchestratorTestHooks(null);
  }

  const log = extractLogPayload();
  const finalResponse = outboundMessages[outboundMessages.length - 1] || '';
  const failures = [];

  if (log?.resolvedLanguage !== langRow.lang) {
    failures.push(`resolvedLanguage expected ${langRow.lang}, got ${log?.resolvedLanguage}`);
  }
  if (log?.resolutionReason !== 'high_confidence_detection') {
    failures.push(`resolutionReason expected high_confidence_detection, got ${log?.resolutionReason}`);
  }

  if (scenario === 'rank' && log?.intent !== 'college_predictor') {
    failures.push(`intent expected college_predictor, got ${log?.intent}`);
  }
  if (scenario === 'greeting' && log?.intent !== 'greeting') {
    failures.push(`intent expected greeting, got ${log?.intent}`);
  }

  const verification = assertReplyLanguage(finalResponse, langRow.lang);
  if (!verification.pass) {
    failures.push(`reply language mismatch: ${verification.reason}`);
  }

  return {
    lang: langRow.lang,
    scenario,
    input,
    pass: failures.length === 0,
    failures,
    log: log
      ? {
          intent: log.intent,
          resolvedLanguage: log.resolvedLanguage,
          finalResponseLanguage: log.finalResponseLanguage,
          verifiedResponseLanguage: log.verifiedResponseLanguage,
          languageMismatch: log.languageMismatch,
        }
      : null,
    finalResponsePreview: finalResponse.slice(0, 160),
  };
}

function buildMarkdownReport(matrixResults) {
  const lines = [
    '# Phase 6 Language Accuracy Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Language | Greeting | Branch | Rank | Unknown | Pass %',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of matrixResults) {
    const cells = SCENARIOS.map((scenario) => {
      const hit = row.scenarios.find((item) => item.scenario === scenario);
      return hit?.pass ? 'PASS' : 'FAIL';
    });
    lines.push(`| ${row.lang} | ${cells.join(' | ')} | ${row.passPct}% |`);
  }

  lines.push('');
  lines.push('## Failures');
  for (const row of matrixResults) {
    for (const scenario of row.scenarios) {
      if (!scenario.pass) {
        lines.push(`- **${row.lang}/${scenario.scenario}**: ${scenario.failures.join('; ')}`);
      }
    }
  }

  const allPass = matrixResults.every((row) => row.passPct === 100);
  lines.push('');
  lines.push(`## Final verdict: ${allPass ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

async function main() {
  if (String(process.env.CHATBOT_MULTILINGUAL_ENABLED || '').trim() !== '1') {
    throw new Error('CHATBOT_MULTILINGUAL_ENABLED must be 1');
  }
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    throw new Error('LLM_API_KEY required for language matrix audit');
  }

  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  delete require.cache[orchestratorPath];
  const orchestrator = require(orchestratorPath);

  const matrixResults = [];
  for (const langRow of LANGUAGE_MATRIX) {
    const scenarios = [];
    for (const scenario of SCENARIOS) {
      capturedStructuredLogs.length = 0;
      console.log(`\n=== ${langRow.lang}/${scenario}: ${langRow[scenario]} ===`);
      const result = await runProbe(orchestrator, langRow, scenario);
      scenarios.push(result);
      console.log(result.pass ? 'PASS' : 'FAIL');
      for (const failure of result.failures) {
        console.log('  -', failure);
      }
    }
    const passCount = scenarios.filter((row) => row.pass).length;
    matrixResults.push({
      lang: langRow.lang,
      scenarios,
      passPct: Math.round((passCount / SCENARIOS.length) * 100),
    });
  }

  const outDir = path.join(__dirname, '..', 'docs', 'phase-6-validation-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'language-matrix-audit-results.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), matrixResults }, null, 2)
  );

  const report = buildMarkdownReport(matrixResults);
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'phase-6-language-accuracy-report.md'), report);

  const allPass = matrixResults.every((row) => row.passPct === 100);
  console.log(`\nReport: docs/phase-6-language-accuracy-report.md`);
  console.log(allPass ? 'LANGUAGE MATRIX 100% PASS' : 'LANGUAGE MATRIX HAS FAILURES');

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
