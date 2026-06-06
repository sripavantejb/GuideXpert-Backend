#!/usr/bin/env node
'use strict';

/**
 * Live audit: 8 greeting languages — resolved language must follow current message.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const structuredLogPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const { GREETING_REPLIES } = require('../constants/greetingReplies');
const { assertReplyLanguage } = require('../utils/replyLanguageVerifier');

const capturedStructuredLogs = [];
const structuredLog = require(structuredLogPath);
const originalLogChatbotEvent = structuredLog.logChatbotEvent;
structuredLog.logChatbotEvent = function captureLogChatbotEvent(event, fields = {}) {
  capturedStructuredLogs.push({ event, fields: { ...fields } });
  return originalLogChatbotEvent.call(this, event, fields);
};

const GREETING_CASES = [
  { id: 'greet_en', expected: 'en', input: 'How are you?' },
  { id: 'greet_te', expected: 'te', input: 'మీరు ఎలా ఉన్నారు?' },
  { id: 'greet_hi', expected: 'hi', input: 'आप कैसे हैं?' },
  { id: 'greet_ta', expected: 'ta', input: 'நீங்கள் எப்படி இருக்கிறீர்கள்?' },
  { id: 'greet_ml', expected: 'ml', input: 'നിങ്ങൾക്ക് സുഖമാണോ?' },
  { id: 'greet_kn', expected: 'kn', input: 'ನೀವು ಹೇಗಿದ್ದೀರಿ?' },
  { id: 'greet_mr', expected: 'mr', input: 'तुम्ही कसे आहात?' },
  { id: 'greet_bn', expected: 'bn', input: 'আপনি কেমন আছেন?' },
];

function extractLogPayload(eventName = 'inbound_processed') {
  const entries = capturedStructuredLogs.filter((row) => row.event === eventName);
  return entries.length ? entries[entries.length - 1].fields : null;
}

function verifyGreetingReply(expected, finalResponse) {
  if (expected === 'en') {
    return finalResponse === GREETING_REPLIES.en;
  }
  if (finalResponse === GREETING_REPLIES[expected]) {
    return true;
  }
  return assertReplyLanguage(finalResponse, expected).pass;
}

async function runGreetingCase(orchestrator, testCase) {
  const outboundMessages = [];
  const conversationId = new mongoose.Types.ObjectId();
  const inboundId = new mongoose.Types.ObjectId();

  orchestrator.setChatbotOrchestratorTestHooks({
    buildLeadContext: async () => ({
      productLine: 'iit_counselling',
      iit: { preferredLanguage: 'Telugu' },
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
        text: testCase.input,
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

  if (log?.resolvedLanguage !== testCase.expected) {
    failures.push(`resolvedLanguage expected ${testCase.expected}, got ${log?.resolvedLanguage}`);
  }
  if (log?.resolutionReason !== 'high_confidence_detection') {
    failures.push(`resolutionReason expected high_confidence_detection, got ${log?.resolutionReason}`);
  }
  if (!verifyGreetingReply(testCase.expected, finalResponse)) {
    failures.push(`expected localized greeting for ${testCase.expected}`);
  }

  return {
    id: testCase.id,
    input: testCase.input,
    expected: testCase.expected,
    pass: failures.length === 0,
    failures,
    log: log
      ? {
          detectedLanguage: log.detectedLanguage,
          confidence: log.confidence,
          preferredLanguage: log.preferredLanguage,
          resolvedLanguage: log.resolvedLanguage,
          outboundLanguage: log.outboundLanguage,
          finalResponseLanguage: log.finalResponseLanguage,
          resolutionReason: log.resolutionReason,
        }
      : null,
    finalResponse,
  };
}

async function main() {
  if (String(process.env.CHATBOT_MULTILINGUAL_ENABLED || '').trim() !== '1') {
    throw new Error('CHATBOT_MULTILINGUAL_ENABLED must be 1');
  }

  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  delete require.cache[orchestratorPath];
  const orchestrator = require(orchestratorPath);

  const results = [];
  for (const testCase of GREETING_CASES) {
    console.log(`\n=== ${testCase.id}: ${testCase.input} ===`);
    const result = await runGreetingCase(orchestrator, testCase);
    results.push(result);
    console.log(result.pass ? 'PASS' : 'FAIL');
    if (result.failures.length) {
      for (const failure of result.failures) {
        console.log('  -', failure);
      }
    }
    console.log(JSON.stringify(result.log, null, 2));
  }

  const outDir = path.join(__dirname, '..', 'docs', 'phase-6-validation-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'greeting-audit-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

  const allPass = results.every((row) => row.pass);
  console.log(`\nResults: ${outPath}`);
  console.log(allPass ? 'ALL GREETING AUDITS PASSED' : 'SOME GREETING AUDITS FAILED');

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
