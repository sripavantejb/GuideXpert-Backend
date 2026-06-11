'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  resolveSessionAwareLanguage,
  isShortCpaFollowUp,
} = require('../services/chatbot/conversationLanguageService');

describe('CPA session language continuity', () => {
  test('short CPA follow-ups inherit session language', () => {
    assert.equal(isShortCpaFollowUp('fees'), true);
    assert.equal(isShortCpaFollowUp('fees kya hai'), true);

    const resolved = resolveSessionAwareLanguage({
      conversation: { preferredLanguage: 'hi' },
      leadContext: {},
      detected: { language: 'en', confidence: 0.9 },
      message: 'fees',
      sessionLanguage: 'hi',
    });

    assert.equal(resolved.language, 'hi');
    assert.equal(resolved.resolutionReason, 'cpa_session_language');
  });

  test('Telugu session keeps Telugu on benefits enti follow-up', () => {
    const resolved = resolveSessionAwareLanguage({
      conversation: {},
      leadContext: {},
      detected: { language: 'en', confidence: 0.85 },
      message: 'benefits enti',
      sessionLanguage: 'te',
    });

    assert.equal(resolved.language, 'te');
    assert.equal(resolved.resolutionReason, 'cpa_session_language');
  });

  test('explicit English greeting still switches session to English', () => {
    const resolved = resolveSessionAwareLanguage({
      conversation: { preferredLanguage: 'hi' },
      leadContext: {},
      detected: { language: 'en', confidence: 0.5 },
      message: 'hi',
      sessionLanguage: 'hi',
    });

    assert.equal(resolved.language, 'en');
    assert.equal(resolved.resolutionReason, 'explicit_english_greeting');
  });
});

describe('CPA orchestrator session language patch', () => {
  const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
  const counsellorProgramPath = require.resolve(
    '../services/chatbot/counsellorProgram/counsellorProgramAssistantService'
  );
  const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
  const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');
  const detectPath = require.resolve('../services/language/languageDetectionService');
  const translatePath = require.resolve('../services/language/translationService');

  const CONVERSATION_ID = new mongoose.Types.ObjectId();

  afterEach(() => {
    delete process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED;
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    mock.restoreAll();
    [
      orchestratorPath,
      counsellorProgramPath,
      middlewarePath,
      conversationLangPath,
      detectPath,
      translatePath,
    ].forEach((p) => delete require.cache[p]);
  });

  beforeEach(() => {
    process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED = '1';
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
  });

  function loadOrchestrator() {
    [
      orchestratorPath,
      counsellorProgramPath,
      middlewarePath,
      conversationLangPath,
      detectPath,
      translatePath,
    ].forEach((p) => delete require.cache[p]);

    const detection = require(detectPath);
    mock.method(detection, 'detectLanguage', async ({ message }) => {
      if (/kya hai|karte ho/i.test(message)) {
        return { language: 'hi', confidence: 0.92, source: 'offline' };
      }
      return { language: 'en', confidence: 0.9, source: 'offline' };
    });

    const translation = require(translatePath);
    mock.method(translation, 'translateToEnglish', async (text) => `EN:${text}`);
    mock.method(translation, 'translateFromEnglish', async (text, lang) => ({
      text:
        lang === 'hi'
          ? 'GuideXpert counselling programs ke baare mein main aapki madad kar sakta hoon.'
          : lang === 'te'
            ? 'GuideXpert counselling programs gurinchi meeku sahayam cheyagalanu.'
            : text,
      translateFromEnglishExecuted: true,
      passThrough: false,
    }));

    const conversationLang = require(conversationLangPath);
    mock.method(conversationLang, 'seedPreferredLanguageFromLead', async () => null);
    mock.method(conversationLang, 'recordDetectedLanguage', async () => {});
    mock.method(conversationLang, 'updatePreferredLanguage', async () => 'hi');

    const counsellorProgram = require(counsellorProgramPath);
    mock.method(counsellorProgram, 'answerWithTimeout', async () => ({
      text: 'English program answer',
      model: 'test-model',
    }));

    const middleware = require(middlewarePath);
    mock.method(middleware, 'applyMultilingualOutbound', async ({ replyText, resolvedLanguage }) => {
      const lang = String(resolvedLanguage || 'en').toLowerCase();
      const text =
        lang === 'hi'
          ? 'मैं GuideXpert counselling programs के बारे में आपकी मदद कर सकता हूँ।'
          : lang === 'te'
            ? 'GuideXpert counselling programs గురించి మీకు సహాయం చేయగలను.'
            : replyText;
      return {
        text,
        verification: { pass: true, detected: lang, reason: null },
        outboundTrace: {},
      };
    });

    return require(orchestratorPath);
  }

  test('Hindi CPA opener then fees follow-up keeps Hindi outbound and session language', async () => {
    const orchestrator = loadOrchestrator();
    const outbound = [];
    let contextPatch = null;

    orchestrator.setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({ productLine: 'unknown' }),
      retrieveFacts: async () => ({ links: [] }),
      getBotState: async () => ({
        state: 'idle',
        context: contextPatch || {},
      }),
      transitionState: async (_id, _phone, _state, patch) => {
        contextPatch = patch;
      },
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

    const conversation = {
      _id: CONVERSATION_ID,
      phone: '9347763131',
      productLine: 'unknown',
      status: 'active',
    };

    await orchestrator.processInbound({
      conversation,
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        text: 'aap kaunse counselling programs provide karte ho',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(contextPatch?.counsellorProgramAssistantActive, true);
    assert.equal(contextPatch?.counsellorProgramSessionLanguage, 'hi');
    assert.match(outbound[0], /GuideXpert counselling programs|मदद कर सकता/i);

    await orchestrator.processInbound({
      conversation,
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        text: 'fees',
        messageType: 'text',
      },
      leadLinks: [],
    });

    assert.equal(contextPatch?.counsellorProgramSessionLanguage, 'hi');
    assert.match(outbound[1], /GuideXpert counselling programs|मदद कर सकता/i);
    orchestrator.setChatbotOrchestratorTestHooks(null);
  });
});
