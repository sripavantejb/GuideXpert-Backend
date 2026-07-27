'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  processInbound,
  setChatbotOrchestratorTestHooks,
} = require('../services/chatbot/chatbotOrchestratorService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const { isGuidedFlowInterrupt } = require('../services/chatbot/guidedFlows/guidedFlowInterruptPolicy');
const { shouldBypassScopeFirewall } = require('../services/chatbot/guidedFlows/guidedFlowRegistry');
const {
  setCollegePredictionIdempotencyDeps,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictionIdempotencyService');
const { EXAM_TS } = require('../constants/whatsappCollegePredictor');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

const COLLEGE_CTX_AFTER_EXAM = {
  flow: 'college_predictor',
  step: 'rank',
  conversational: true,
  exam: EXAM_TS,
};

describe('collegePredictor orchestrator routing', () => {
  let outboundCalls;
  let prevScopeFirewall;

  beforeEach(() => {
    prevScopeFirewall = process.env.CHATBOT_SCOPE_FIREWALL_ENABLED;
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    outboundCalls = [];
    setCollegePredictorDeps({
      getPredictedColleges: async () => ({
        colleges: [{ college_name: 'Test', branches: [{ branch_name: 'CSE' }] }],
        total_no_of_colleges: 1,
      }),
    });
    setCollegePredictionIdempotencyDeps({
      getInboundPredictionCompletion: async () => null,
      claimInboundPredictionCompletion: async (_inboundId, completion) => ({
        record: completion,
        isNewClaim: true,
      }),
    });

    setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({
        phone: '9876543210',
        productLine: 'iit_counselling',
        hasIit: true,
        iit: { fullName: 'Test' },
      }),
      retrieveFacts: async (_links, leadContext) => ({ lead: leadContext, links: {} }),
      getBotState: async () => ({
        state: 'college_predictor',
        context: { college: { ...COLLEGE_CTX_AFTER_EXAM } },
      }),
      transitionState: async (_cid, _phone, state, context) => ({ state, context }),
      resetToMainMenu: async () => ({ state: 'main_menu', context: {} }),
      isBotPausedForConversation: async () => false,
      cancelActiveHandoffForUser: async () => ({ cancelled: false }),
      createHandoff: async () => ({ _id: new mongoose.Types.ObjectId() }),
      updateConversationIntent: async () => {},
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push(args);
          return { success: true };
        },
        sendBotButtonReply: async () => ({ success: true }),
        sendBotListReply: async () => ({ success: true }),
      },
    });
  });

  afterEach(() => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = prevScopeFirewall;
    setChatbotOrchestratorTestHooks(null);
    setCollegePredictorDeps({});
    setCollegePredictionIdempotencyDeps({});
  });

  test('isGuidedFlowInterrupt allows slot values but blocks menu and agent', () => {
    assert.equal(isGuidedFlowInterrupt('20000'), false);
    assert.equal(isGuidedFlowInterrupt('BC-B'), false);
    assert.equal(isGuidedFlowInterrupt('my category is BC-B'), false);
    assert.equal(isGuidedFlowInterrupt('menu'), true);
    assert.equal(isGuidedFlowInterrupt('agent'), true);
    assert.equal(isGuidedFlowInterrupt('cancel'), true);
  });

  test('shouldBypassScopeFirewall for active college predictor state', () => {
    assert.equal(
      shouldBypassScopeFirewall({ state: 'college_predictor' }, 'unknown'),
      true
    );
    assert.equal(
      shouldBypassScopeFirewall({ state: 'main_menu' }, 'college_predictor_continue'),
      true
    );
    assert.equal(shouldBypassScopeFirewall({ state: 'main_menu' }, 'faq'), true);
  });

  test('active college_predictor routes rank slot past scope firewall', async () => {
    await processInbound({
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
      },
      inbound: {
        _id: INBOUND_ID,
        messageType: 'text',
        text: '20000',
      },
      leadLinks: { phone10: '9876543210' },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0].text || '';
    assert.match(text, /category|reservation/i);
    assert.doesNotMatch(text, /I'm here to help only with GuideXpert services/i);
  });

  test('active college_predictor routes BC-B category slot past scope firewall', async () => {
    setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => ({
        phone: '9876543210',
        productLine: 'iit_counselling',
        hasIit: true,
        iit: { fullName: 'Test' },
      }),
      retrieveFacts: async (_links, leadContext) => ({ lead: leadContext, links: {} }),
      getBotState: async () => ({
        state: 'college_predictor',
        context: {
          college: {
            ...COLLEGE_CTX_AFTER_EXAM,
            rank: 20000,
            step: 'category',
          },
        },
      }),
      transitionState: async (_cid, _phone, state, context) => ({ state, context }),
      resetToMainMenu: async () => ({ state: 'main_menu', context: {} }),
      isBotPausedForConversation: async () => false,
      cancelActiveHandoffForUser: async () => ({ cancelled: false }),
      createHandoff: async () => ({ _id: new mongoose.Types.ObjectId() }),
      updateConversationIntent: async () => {},
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push(args);
          return { success: true };
        },
        sendBotButtonReply: async () => ({ success: true }),
        sendBotListReply: async () => ({ success: true }),
      },
    });

    await processInbound({
      conversation: {
        _id: CONVERSATION_ID,
        phone: '9876543210',
        productLine: 'iit_counselling',
      },
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        messageType: 'text',
        text: 'BC-B',
      },
      leadLinks: { phone10: '9876543210' },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0].text || '';
    assert.match(text, /Male or Female|gender/i);
    assert.doesNotMatch(text, /I'm here to help only with GuideXpert services/i);
  });

  test('TS EAMCET then 20000 flow via handleCollegePredictorMessage', async () => {
    let ctx = {};
    let r = await handleCollegePredictorMessage('TS EAMCET', ctx, { isNewEntry: true });
    assert.match(r.reply, /rank/i);
    r = await handleCollegePredictorMessage('20000', r.context);
    assert.match(r.reply, /category|reservation/i);
    r = await handleCollegePredictorMessage('BC-B', r.context);
    assert.match(r.reply, /Male or Female|gender/i);
  });
});
