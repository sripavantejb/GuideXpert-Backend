'use strict';

const { afterEach, beforeEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  classifyIntent,
  isMarksBasedRankPredictorQuery,
  isRankBranchCollegePredictorQuery,
} = require('../services/chatbot/intentClassifierService');
const { handleRankPredictorMessage } = require('../services/chatbot/rankPredictorChatService');
const {
  resolveCollegePredictorRankQueryUnavailableReply,
  COLLEGE_PREDICTOR_RANK_QUERY_UNAVAILABLE,
} = require('../constants/collegePredictorUnavailableReplies');
const {
  setCollegePredictionIdempotencyDeps,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictionIdempotencyService');

const PRODUCT_LINE = 'iit_counselling';
const orchestratorPath = require.resolve('../services/chatbot/chatbotOrchestratorService');
const middlewarePath = require.resolve('../middleware/multilingualMiddleware');
const conversationLangPath = require.resolve('../services/chatbot/conversationLanguageService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

function loadOrchestratorWithMocks({ prepareMultilingualInbound, finalizeMultilingualOutbound } = {}) {
  [orchestratorPath, middlewarePath, conversationLangPath].forEach((path) => delete require.cache[path]);

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

  return require(orchestratorPath);
}

describe('predictor intent routing', () => {
  test('rank + branch routes to college_predictor', () => {
    const cases = [
      'Can I get CSE with rank 15000?',
      '15000 rank ki cse vastunda',
      '15000 ర్యాంక్‌తో CSE వస్తుందా?',
    ];
    for (const text of cases) {
      const r = classifyIntent(text, null, PRODUCT_LINE);
      assert.equal(r.intent, 'college_predictor', text);
      assert.equal(r.confidence, 'high', text);
    }
  });

  test('rank + branch beats knowledge session', () => {
    const r = classifyIntent(
      'Can I get CSE with rank 15000?',
      { state: 'idle', context: { knowledgeAssistantActive: true } },
      PRODUCT_LINE
    );
    assert.equal(r.intent, 'college_predictor');
  });

  test('marks-based queries route to rank_predictor', () => {
    const cases = [
      'I scored 85 marks in TS EAMCET',
      'TS EAMCET 85 marks',
      'I got 85 marks in TS EAMCET',
      'AP EAMCET lo 70 marks vachayi',
      'JEE Main score 120',
    ];
    for (const text of cases) {
      const r = classifyIntent(text, null, PRODUCT_LINE);
      assert.equal(r.intent, 'rank_predictor', text);
      assert.ok(isMarksBasedRankPredictorQuery(text), text);
      assert.equal(isRankBranchCollegePredictorQuery(text), false, text);
    }
  });

  test('TS EAMCET marks parses exam in rank predictor flow', () => {
    const r = handleRankPredictorMessage('TS EAMCET 85 marks', {});
    assert.match(r.reply, /Prediction for TS EAMCET/i);
    assert.equal(r.context.step, 'done');
  });

  test('TS EAMCET appears in rank predictor exam prompt when exam missing', () => {
    const r = handleRankPredictorMessage('hello', {});
    assert.match(r.reply, /TS EAMCET/i);
    assert.equal(r.context.step, 'awaiting_exam_score');
  });

  test('localized college predictor unavailable replies exist for 8 languages', () => {
    for (const lang of ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn']) {
      const reply = resolveCollegePredictorRankQueryUnavailableReply(lang);
      assert.ok(reply.includes('College Predictor'), lang);
      assert.ok(reply.includes('Rank Predictor'), lang);
      assert.ok(reply.includes('MENU'), lang);
      if (lang !== 'en') {
        assert.notEqual(reply, COLLEGE_PREDICTOR_RANK_QUERY_UNAVAILABLE.en);
      }
    }
  });
});

describe('predictor intent orchestrator college rank+branch routing', () => {
  beforeEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.CHATBOT_MULTILINGUAL_ENABLED;
    setCollegePredictionIdempotencyDeps({});
    mock.restoreAll();
    [orchestratorPath, middlewarePath, conversationLangPath].forEach((p) => delete require.cache[p]);
  });

  async function runCase({ text, mockInbound, expectedSnippet }) {
    let finalizeCalls = 0;
    setCollegePredictionIdempotencyDeps({
      getInboundPredictionCompletion: async () => null,
      claimInboundPredictionCompletion: async (_inboundId, completion) => ({
        record: completion,
        isNewClaim: true,
      }),
    });
    const orchestrator = loadOrchestratorWithMocks({
      prepareMultilingualInbound: async () => mockInbound,
      finalizeMultilingualOutbound: async () => {
        finalizeCalls += 1;
        return 'translated';
      },
    });

    const outbound = [];
    orchestrator.setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({ productLine: PRODUCT_LINE }),
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
        productLine: PRODUCT_LINE,
        status: 'active',
      },
      inbound: { _id: INBOUND_ID, text, direction: 'inbound' },
      leadLinks: {},
    });

    orchestrator.setChatbotOrchestratorTestHooks(null);
    setCollegePredictionIdempotencyDeps({});
    assert.equal(finalizeCalls, 0);
    assert.ok(outbound.length >= 1);
    assert.match(String(outbound[0]), expectedSnippet);
  }

  test('English rank+branch starts college predictor conversational flow', async () => {
    await runCase({
      text: 'Can I get CSE with rank 15000?',
      mockInbound: {
        originalMessage: 'Can I get CSE with rank 15000?',
        englishMessage: 'Can I get CSE with rank 15000?',
        language: 'en',
        detectedLanguage: 'en',
        confidence: 0.92,
        translationApplied: false,
        resolvedLanguage: 'en',
      },
      expectedSnippet: /Sure! I can help you predict colleges/,
    });
  });

  test('Telugu rank+branch starts college predictor with extracted rank', async () => {
    await runCase({
      text: '15000 ర్యాంక్‌తో CSE వస్తుందా?',
      mockInbound: {
        originalMessage: '15000 ర్యాంక్‌తో CSE వస్తుందా?',
        englishMessage: 'Can I get CSE with rank 15000?',
        language: 'te',
        detectedLanguage: 'te',
        confidence: 0.88,
        translationApplied: true,
        resolvedLanguage: 'te',
      },
      expectedSnippet: /Sure! I can help you predict colleges|Which entrance exam did you write/,
    });
  });
});
