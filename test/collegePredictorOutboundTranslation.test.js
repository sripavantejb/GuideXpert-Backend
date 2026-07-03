'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  processInbound,
  setChatbotOrchestratorTestHooks,
} = require('../services/chatbot/chatbotOrchestratorService');
const { setCollegePredictorDeps } = require('../services/chatbot/collegePredictorChatService');
const {
  setCollegePredictionIdempotencyDeps,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictionIdempotencyService');
const { setTranslationProvider } = require('../services/language/translationService');
const { EXAM_TS } = require('../constants/whatsappCollegePredictor');
const { applyMultilingualOutbound } = require('../middleware/multilingualMiddleware');

const PHONE = '9876543210';
const CONV = {
  _id: new mongoose.Types.ObjectId(),
  phone: PHONE,
  productLine: 'iit_counselling',
  preferredLanguage: 'te',
};

describe('college predictor outbound translation', () => {
  let prevMultilingual;
  let outboundCalls;

  beforeEach(() => {
    prevMultilingual = process.env.CHATBOT_MULTILINGUAL_ENABLED;
    process.env.CHATBOT_MULTILINGUAL_ENABLED = '1';
    outboundCalls = [];

    setCollegePredictionIdempotencyDeps({
      getInboundPredictionCompletion: async () => null,
      claimInboundPredictionCompletion: async (_id, completion) => ({
        record: completion,
        isNewClaim: true,
      }),
    });

    setCollegePredictorDeps({
      getPredictedColleges: async () => ({
        colleges: [
          {
            college_name: 'VASAVI COLLEGE OF ENGINEERING',
            branches: [
              {
                branch_name: 'COMPUTER SCIENCE AND ENGINEERING',
                reservation_categories: [{ cutoff_rank: 4782, category_name: 'BCB BOYS' }],
              },
            ],
          },
        ],
        total_no_of_colleges: 1,
      }),
    });

    setTranslationProvider({
      chatCompletion: async () => {
        throw new Error('Request timed out.');
      },
    });

    setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({
        phone: PHONE,
        productLine: 'iit_counselling',
        hasIit: true,
      }),
      retrieveFacts: async (_l, lc) => ({ lead: lc, links: {} }),
      getBotState: async () => ({
        state: 'college_predictor',
        context: {
          college: {
            flow: 'college_predictor',
            step: 'gender',
            conversational: true,
            exam: EXAM_TS,
            rank: 2900,
            categoryN: 3,
            categoryLabel: 'BC-B',
            baseCategory: 'BC-B',
          },
        },
      }),
      transitionState: async (_c, _p, state, context) => ({ state, context }),
      resetToMainMenu: async () => ({ state: 'main_menu', context: {} }),
      isBotPausedForConversation: async () => false,
      cancelActiveHandoffForUser: async () => ({ cancelled: false }),
      createHandoff: async () => ({ _id: new mongoose.Types.ObjectId() }),
      updateConversationIntent: async () => {},
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push(args.text);
          return { success: true };
        },
        sendBotButtonReply: async () => ({ success: true }),
        sendBotListReply: async () => ({ success: true }),
      },
    });
  });

  afterEach(() => {
    process.env.CHATBOT_MULTILINGUAL_ENABLED = prevMultilingual;
    setTranslationProvider(null);
    setChatbotOrchestratorTestHooks(null);
    setCollegePredictorDeps({});
    setCollegePredictionIdempotencyDeps({});
  });

  test('applyMultilingualOutbound keeps English college list when Telugu translation fails', async () => {
    const englishReply =
      'Here are your predicted colleges:\n\nExam: TS EAMCET\nRank/Percentile: 2900\nTop Matches:\n\n1. VASAVI COLLEGE OF ENGINEERING';
    const result = await applyMultilingualOutbound({
      replyText: englishReply,
      resolvedLanguage: 'te',
      originalMessage: '1',
      localizationTier: 'translate',
    });
    assert.match(result.text, /VASAVI COLLEGE OF ENGINEERING/i);
    assert.doesNotMatch(result.text, /క్షమించండి|something went wrong/i);
    assert.equal(result.outboundTrace.usedEnglishFallback, true);
  });

  test('TS EAMCET 2900 BC-B 1 delivers colleges when translation times out', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '0';
    await processInbound({
      conversation: CONV,
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: '1' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0] || '';
    assert.match(text, /predicted colleges|VASAVI|ENGINEERING/i);
    assert.doesNotMatch(text, /క్షమించండి|something went wrong on our side/i);
  });
});
