'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const llmReplyPath = require.resolve('../services/chatbot/llmReplyService');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');
const intentPath = require.resolve('../services/chatbot/intentClassifierService');
const detectPath = require.resolve('../services/language/languageDetectionService');
const resolvePath = require.resolve('../services/chatbot/conversationLanguageService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMocks({
  prepareMultilingualInbound,
  finalizeMultilingualOutbound,
  tryLlmReply,
} = {}) {
  [
    orchestratorPath,
    middlewarePath,
    llmReplyPath,
    conversationLangPath,
  ].forEach((path) => delete require.cache[path]);

  const middleware = require(middlewarePath);
  if (prepareMultilingualInbound) {
    mock.method(middleware, 'prepareMultilingualInbound', prepareMultilingualInbound);
  }
  if (finalizeMultilingualOutbound) {
    mock.method(middleware, 'finalizeMultilingualOutbound', finalizeMultilingualOutbound);
  }

  const conversationLang = require(conversationLangPath);
  mock.method(conversationLang, 'seedPreferredLanguageFromLead', async () => null);
  mock.method(conversationLang, 'recordDetectedLanguage', async () => {});

  if (tryLlmReply) {
    const llmReplyService = require(llmReplyPath);
    mock.method(llmReplyService, 'tryLlmReply', tryLlmReply);
  }

  return require(orchestratorPath);
}

describe('multilingual regression matrix', () => {
  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED = '1';
    process.env.LANGUAGE_DETECT_LLM_FALLBACK = '0';
  });

  afterEach(() => {
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    delete process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED;
    delete process.env.LANGUAGE_DETECT_LLM_FALLBACK;
    mock.restoreAll();
  });

  test('mixed-language detection resolves te/hi for counselling phrases', async () => {
    const { detectLanguage, setLanguageDetectionProvider } = require(detectPath);
    setLanguageDetectionProvider({
      chatCompletion: async () => {
        throw new Error('LLM should not be called');
      },
    });

    const cases = [
      { message: 'naaku cse kavali', language: 'te', source: 'romanized' },
      { message: 'mujhe cse chahiye', language: 'hi', source: 'romanized' },
      { message: '15000 rank ki cse vastunda', language: 'te', source: 'romanized' },
      { message: 'meri rank 15000 hai', language: 'hi', source: 'romanized' },
    ];

    for (const { message, language, source } of cases) {
      const result = await detectLanguage({ message });
      assert.equal(result.language, language, message);
      assert.equal(result.source, source, message);
    }
  });

  test('rank+branch intent beats knowledge session', () => {
    const { classifyIntent } = require(intentPath);
    const r = classifyIntent(
      'Can I get CSE with rank 15000?',
      { state: 'idle', context: { knowledgeAssistantActive: true } },
      'iit_counselling'
    );
    assert.equal(r.intent, 'rank_predictor');
  });

  for (const row of [
    { english: 'Can I get CSE with rank 15000?', intent: 'rank_predictor' },
    { english: 'I need CSE', intent: 'unknown' },
    { english: 'My rank is 15000', intent: 'rank_predictor' },
  ]) {
    test(`intent matrix english pivot: ${row.english}`, () => {
      const { classifyIntent } = require(intentPath);
      const r = classifyIntent(row.english, null, 'iit_counselling');
      assert.equal(r.intent, row.intent);
    });
  }

  test('rank_predictor outbound uses finalizeMultilingualOutbound when resolved te', async () => {
    let finalizeCalls = 0;
    const orchestrator = loadOrchestratorWithMocks({
      prepareMultilingualInbound: async () => ({
        originalMessage: '15000 rank ki cse vastunda',
        englishMessage: 'Can I get CSE with rank 15000?',
        language: 'te',
        detectedLanguage: 'te',
        confidence: 0.88,
        translationApplied: true,
        resolvedLanguage: 'te',
        detectionSource: 'romanized',
      }),
      finalizeMultilingualOutbound: async (args) => {
        finalizeCalls += 1;
        return `Telugu: ${args.englishResponse}`;
      },
    });

    const outbound = [];
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
      },
      inbound: {
        _id: INBOUND_ID,
        text: '15000 rank ki cse vastunda',
        direction: 'inbound',
      },
      leadLinks: {},
    });

    assert.ok(finalizeCalls >= 1);
    assert.match(String(outbound[0] || ''), /^Telugu:/);

    orchestrator.setChatbotOrchestratorTestHooks(null);
    [
      orchestratorPath,
      middlewarePath,
      llmReplyPath,
      conversationLangPath,
    ].forEach((path) => delete require.cache[path]);
  });

  test('translateFromEnglish accepts kn ml mr bn targets', async () => {
    const translationPath = require.resolve('../services/language/translationService');
    delete require.cache[translationPath];
    const translation = require(translationPath);
    const targets = [];

    translation.setTranslationProvider({
      chatCompletion: async ({ messages }) => {
        const prompt = messages[0]?.content || '';
        const match = prompt.match(/language code (\w+)/i);
        if (match) targets.push(match[1]);
        return { text: `localized-${match ? match[1] : 'unknown'}` };
      },
    });

    for (const lang of ['kn', 'ml', 'mr', 'bn']) {
      const result = await translation.translateFromEnglish('CSE is a strong option.', lang);
      assert.equal(result, `localized-${lang}`, lang);
    }
    assert.deepEqual(targets, ['kn', 'ml', 'mr', 'bn']);

    translation.setTranslationProvider(null);
    delete require.cache[translationPath];
  });

  test('greeting replies exist for ta kn ml mr bn', () => {
    const { resolveGreetingReply, GREETING_REPLIES } = require('../constants/greetingReplies');
    for (const lang of ['ta', 'kn', 'ml', 'mr', 'bn']) {
      assert.ok(GREETING_REPLIES[lang]);
      assert.notEqual(resolveGreetingReply(lang), GREETING_REPLIES.en);
    }
  });

  test('localized guardrail fallbacks exist for kn ml mr bn', () => {
    const { LOCALIZED_GUARDRAIL_FALLBACKS } = require('../constants/localizedFallbackStrings');
    const { UNSUPPORTED_CLAIM_FALLBACK } = require('../services/chatbot/aiGuardrailService');
    for (const lang of ['kn', 'ml', 'mr', 'bn']) {
      assert.ok(LOCALIZED_GUARDRAIL_FALLBACKS[lang]);
      assert.ok(LOCALIZED_GUARDRAIL_FALLBACKS[lang][UNSUPPORTED_CLAIM_FALLBACK]);
    }
  });
});

describe('multilingual regression resolveConversationLanguage', () => {
  test('romanized te detection resolves to te without lead preference', () => {
    const { resolveConversationLanguage } = require(resolvePath);
    const resolved = resolveConversationLanguage(null, null, {
      language: 'te',
      confidence: 0.88,
      source: 'romanized',
    });
    assert.equal(resolved.language, 'te');
    assert.equal(resolved.source, 'detection');
  });
});
