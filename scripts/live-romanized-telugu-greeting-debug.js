#!/usr/bin/env node
'use strict';

/**
 * Live runtime trace for Romanized Telugu greetings through full processInbound (WhatsApp path).
 * Set CHATBOT_INTENT_DEBUG=1 for [INTENT_DEBUG] lines from classifier + orchestrator.
 */

require('dotenv').config();

process.env.CHATBOT_INTENT_DEBUG = '1';

const mongoose = require('mongoose');
const structuredLogPath = require.resolve('../services/chatbot/chatbotStructuredLog');
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');

const PROBES = ['Ela vunnaru', 'Ela unnaru', 'bagunnara'];

const capturedStructuredLogs = [];
const structuredLog = require(structuredLogPath);
const originalLogChatbotEvent = structuredLog.logChatbotEvent;
structuredLog.logChatbotEvent = function captureLogChatbotEvent(event, fields = {}) {
  capturedStructuredLogs.push({ event, fields: { ...fields } });
  return originalLogChatbotEvent.call(this, event, fields);
};

function extractLogPayload() {
  const entries = capturedStructuredLogs.filter((row) => row.event === 'inbound_processed');
  return entries.length ? entries[entries.length - 1].fields : null;
}

async function runProbe(orchestrator, input) {
  capturedStructuredLogs.length = 0;
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

  return {
    originalMessage: log?.originalMessage || input,
    detectedLanguage: log?.detectedLanguage || null,
    confidence: log?.confidence ?? null,
    englishMessage: log?.englishMessage || null,
    intent: log?.intent || null,
    intentReason: log?.intentReason || null,
    resolvedLanguage: log?.resolvedLanguage || null,
    outboundLanguage: log?.outboundLanguage || null,
    finalResponse,
    knowledgeAssistantResponse: log?.knowledgeAssistantResponse || null,
    shouldTranslateOutbound: log?.shouldTranslateOutbound ?? null,
    outboundTranslationExecuted: log?.outboundTranslationExecuted ?? null,
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

  for (const input of PROBES) {
    console.log(`\n========== LIVE PROBE: ${input} ==========`);
    const trace = await runProbe(orchestrator, input);
    console.log(JSON.stringify(trace, null, 2));
  }

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
