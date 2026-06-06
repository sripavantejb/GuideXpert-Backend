#!/usr/bin/env node
'use strict';

/**
 * Live Phase 6 multilingual regression validation (real LLM + translation).
 * Captures structured logs and outbound text without sending WhatsApp.
 */

require('dotenv').config();

// Live validation needs headroom for detect + translate-in + RAG + LLM + translate-out.
process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS =
  process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS || '25000';
process.env.OUTBOUND_TRANSLATION_TIMEOUT_MS =
  process.env.OUTBOUND_TRANSLATION_TIMEOUT_MS || '15000';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const structuredLogPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');

const capturedStructuredLogs = [];
const structuredLog = require(structuredLogPath);
const originalLogChatbotEvent = structuredLog.logChatbotEvent;
structuredLog.logChatbotEvent = function captureLogChatbotEvent(event, fields = {}) {
  capturedStructuredLogs.push({ event, fields: { ...fields } });
  return originalLogChatbotEvent.call(this, event, fields);
};

const GUARDRAIL_MARKERS = [
  'I do not have verified information to support that claim',
  'I do not have verified information about that',
  'verified information to support',
];

const TEST_CASES = [
  {
    id: 'test1',
    name: 'Telugu branch question (Knowledge Assistant outbound)',
    input: 'నాకు ఏ బ్రాంచ్ మంచిది?',
    expect: {
      detectedLanguage: 'te',
      resolvedLanguage: 'te',
      shouldTranslateOutbound: true,
      translateFromEnglishExecuted: true,
      outboundTranslationPassThrough: false,
      responseLanguage: 'te',
      noMarkdown: true,
      notFallback: true,
    },
  },
  {
    id: 'test2',
    name: 'Romanized Telugu CSE request',
    input: 'naaku CSE kavali',
    expect: {
      resolvedLanguage: 'te',
      responseLanguage: 'te',
      shouldTranslateOutbound: true,
      translateFromEnglishExecuted: true,
      notFallback: true,
    },
  },
  {
    id: 'test3',
    name: 'Mixed rank + branch (Rank Predictor path)',
    input: '15000 rank ki cse vastunda',
    expect: {
      intent: 'rank_predictor',
      resolvedLanguage: 'te',
      responseLanguage: 'te',
      noGuardrailFallback: true,
    },
  },
  {
    id: 'test4',
    name: 'Hindi CSE request',
    input: 'मुझे CSE चाहिए',
    expect: {
      resolvedLanguage: 'hi',
      responseLanguage: 'hi',
    },
  },
  {
    id: 'test5',
    name: 'Bengali CSE request',
    input: 'আমার CSE চাই',
    expect: {
      resolvedLanguage: 'bn',
      responseLanguage: 'bn',
    },
  },
];

function languageScore(text, scriptRegex) {
  const matches = String(text || '').match(scriptRegex);
  return matches ? matches.length : 0;
}

function detectResponseLanguage(text) {
  const te = languageScore(text, /[\u0C00-\u0C7F]/g);
  const hi = languageScore(text, /[\u0900-\u097F]/g);
  const bn = languageScore(text, /[\u0980-\u09FF]/g);
  const en = languageScore(text, /[A-Za-z]/g);

  const scores = [
    { lang: 'te', score: te },
    { lang: 'hi', score: hi },
    { lang: 'bn', score: bn },
    { lang: 'en', score: en },
  ].sort((a, b) => b.score - a.score);

  if (scores[0].score === 0) return 'unknown';
  if (scores[0].lang === 'en' && scores[1].score > 0 && scores[1].score >= scores[0].score * 0.3) {
    return scores[1].lang;
  }
  return scores[0].lang;
}

function hasBadWhatsAppFormatting(text) {
  return /\|/.test(text) || /###/.test(text) || /<br/i.test(text);
}

function hasGuardrailFallback(text) {
  const value = String(text || '');
  return GUARDRAIL_MARKERS.some((marker) => value.includes(marker));
}

function extractLogPayload(eventName = 'inbound_processed') {
  const entries = capturedStructuredLogs.filter((row) => row.event === eventName);
  return entries.length ? entries[entries.length - 1].fields : null;
}

async function runCase(orchestrator, testCase, conversationId, inboundId) {
  const outboundMessages = [];

  orchestrator.setChatbotOrchestratorTestHooks({
    buildLeadContext: async () => ({ productLine: 'iit_counselling' }),
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
        preferredLanguage: 'en',
      },
      inbound: {
        _id: inboundId,
        text: testCase.input,
        messageType: 'text',
      },
      leadLinks: [],
    });
  } finally {
    orchestrator.setChatbotOrchestratorTestHooks(null);
  }

  const log = extractLogPayload('inbound_processed');
  const finalResponse = outboundMessages[outboundMessages.length - 1] || '';
  const responseLanguage = detectResponseLanguage(finalResponse);
  const failures = [];

  const expect = testCase.expect || {};

  if (expect.detectedLanguage && log?.detectedLanguage !== expect.detectedLanguage) {
    failures.push(`detectedLanguage expected ${expect.detectedLanguage}, got ${log?.detectedLanguage}`);
  }
  if (expect.resolvedLanguage && log?.resolvedLanguage !== expect.resolvedLanguage) {
    failures.push(`resolvedLanguage expected ${expect.resolvedLanguage}, got ${log?.resolvedLanguage}`);
  }
  if (expect.intent && log?.intent !== expect.intent) {
    failures.push(`intent expected ${expect.intent}, got ${log?.intent}`);
  }
  if (expect.shouldTranslateOutbound !== undefined && log?.shouldTranslateOutbound !== expect.shouldTranslateOutbound) {
    failures.push(
      `shouldTranslateOutbound expected ${expect.shouldTranslateOutbound}, got ${log?.shouldTranslateOutbound}`
    );
  }
  if (expect.translateFromEnglishExecuted !== undefined && log?.translateFromEnglishExecuted !== expect.translateFromEnglishExecuted) {
    failures.push(
      `translateFromEnglishExecuted expected ${expect.translateFromEnglishExecuted}, got ${log?.translateFromEnglishExecuted}`
    );
  }
  if (expect.outboundTranslationPassThrough !== undefined && log?.outboundTranslationPassThrough !== expect.outboundTranslationPassThrough) {
    failures.push(
      `outboundTranslationPassThrough expected ${expect.outboundTranslationPassThrough}, got ${log?.outboundTranslationPassThrough}`
    );
  }
  if (expect.responseLanguage && responseLanguage !== expect.responseLanguage) {
    failures.push(`final response language expected ${expect.responseLanguage}, detected ${responseLanguage}`);
  }
  if (expect.notFallback && log?.finalResponse && /అర్థం కాలేదు|not sure I understood/i.test(log.finalResponse)) {
    failures.push('received static unknown fallback instead of assistant reply');
  }
  if (expect.noMarkdown && hasBadWhatsAppFormatting(finalResponse)) {
    failures.push('final response contains markdown/HTML artifacts (|, ###, <br>)');
  }
  if (expect.noGuardrailFallback && hasGuardrailFallback(finalResponse)) {
    failures.push('final response contains guardrail unsupported-claim fallback');
  }

  return {
    id: testCase.id,
    name: testCase.name,
    input: testCase.input,
    pass: failures.length === 0,
    failures,
    log: log
      ? {
          intent: log.intent,
          detectedLanguage: log.detectedLanguage,
          resolvedLanguage: log.resolvedLanguage,
          englishMessage: log.englishMessage,
          shouldTranslateOutbound: log.shouldTranslateOutbound,
          outboundTranslationExecuted: log.outboundTranslationExecuted,
          translateFromEnglishExecuted: log.translateFromEnglishExecuted,
          outboundTranslationPassThrough: log.outboundTranslationPassThrough,
          outboundLanguage: log.outboundLanguage,
          guardrailModified: log.guardrailModified,
          finalResponsePreview: log.finalResponsePreview,
          translatedResponsePreview: log.translatedResponsePreview,
        }
      : null,
    finalResponse,
    responseLanguage,
  };
}

async function main() {
  if (String(process.env.CHATBOT_MULTILINGUAL_ENABLED || '').trim() !== '1') {
    throw new Error('CHATBOT_MULTILINGUAL_ENABLED must be 1');
  }
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    throw new Error('LLM_API_KEY is required for live validation');
  }

  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected for live validation');
  }

  delete require.cache[orchestratorPath];
  const orchestrator = require(orchestratorPath);

  const results = [];
  for (const testCase of TEST_CASES) {
    console.log(`\n=== Running ${testCase.id}: ${testCase.name} ===`);
    console.log(`Input: ${testCase.input}`);
    const conversationId = new mongoose.Types.ObjectId();
    const inboundId = new mongoose.Types.ObjectId();
    const startedAt = Date.now();
    const result = await runCase(orchestrator, testCase, conversationId, inboundId);
    result.durationMs = Date.now() - startedAt;
    results.push(result);
    console.log(result.pass ? 'PASS' : 'FAIL', `(${result.durationMs}ms)`);
    if (result.failures.length) {
      for (const failure of result.failures) {
        console.log('  -', failure);
      }
    }
    console.log('Log:', JSON.stringify(result.log, null, 2));
    console.log('Final response preview:', result.finalResponse.slice(0, 400));
  }

  const outDir = path.join(__dirname, '..', 'docs', 'phase-6-validation-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'live-validation-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

  const allPass = results.every((row) => row.pass);
  console.log(`\nResults written to ${reportPath}`);
  console.log(allPass ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
