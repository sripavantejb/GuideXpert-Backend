'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { GREETING_REPLIES } = require('../constants/greetingReplies');
const { assertReplyLanguage } = require('../utils/replyLanguageVerifier');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');
const detectPath = require.resolve('../services/language/languageDetectionService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

const GREETING_CASES = [
  { lang: 'en', input: 'How are you?' },
  { lang: 'te', input: 'మీరు ఎలా ఉన్నారు?' },
  { lang: 'hi', input: 'आप कैसे हैं?' },
  { lang: 'mr', input: 'तुम्ही कसे आहात?' },
  { lang: 'ml', input: 'നിങ്ങൾക്ക് സുഖമാണോ?' },
];

function loadOrchestrator(detectionMap) {
  [orchestratorPath, middlewarePath, conversationLangPath, detectPath].forEach(
    (p) => delete require.cache[p]
  );

  const detection = require(detectPath);
  mock.method(detection, 'detectLanguage', async ({ message }) => {
    const hit = Object.entries(detectionMap).find(([, text]) => text === message);
    return {
      language: hit ? hit[0] : 'en',
      confidence: 0.88,
      source: hit ? 'offline' : 'fallback',
    };
  });

  const conversationLang = require(conversationLangPath);
  mock.method(conversationLang, 'seedPreferredLanguageFromLead', async () => null);
  mock.method(conversationLang, 'recordDetectedLanguage', async () => {});

  return require(orchestratorPath);
}

describe('languageMatrixOrchestrator greeting cells', () => {
  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    mock.restoreAll();
    [orchestratorPath, middlewarePath, conversationLangPath, detectPath].forEach(
      (p) => delete require.cache[p]
    );
  });

  for (const { lang, input } of GREETING_CASES) {
    test(`greeting ${lang} replies in same language with sticky te preference`, async () => {
      const detectionMap = { [lang]: input };
      const orchestrator = loadOrchestrator(detectionMap);
      const outbound = [];

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
            outbound.push(args.text);
            return { success: true };
          },
        },
      });

      await orchestrator.processInbound({
        conversation: {
          _id: CONVERSATION_ID,
          phone: '9876543210',
          productLine: 'iit_counselling',
          status: 'active',
          preferredLanguage: 'te',
        },
        inbound: { _id: INBOUND_ID, text: input, direction: 'inbound' },
        leadLinks: {},
      });

      orchestrator.setChatbotOrchestratorTestHooks(null);
      const reply = outbound[outbound.length - 1];
      assert.equal(reply, GREETING_REPLIES[lang]);
      assert.equal(assertReplyLanguage(reply, lang).pass, true);
    });
  }
});
