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
const { handleRankPredictorMessage } = require('../services/chatbot/rankPredictorChatService');
const { isGuidedFlowInterrupt } = require('../services/chatbot/guidedFlows/guidedFlowInterruptPolicy');
const {
  listGuidedFlows,
  getGuidedFlowByBotState,
  shouldBypassScopeFirewall,
} = require('../services/chatbot/guidedFlows/guidedFlowRegistry');
const {
  setCollegePredictionIdempotencyDeps,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictionIdempotencyService');
const faqService = require('../services/chatbot/faqService');
const { EXAM_TS } = require('../constants/whatsappCollegePredictor');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

const COLLEGE_CTX_AFTER_EXAM = {
  flow: 'college_predictor',
  step: 'rank',
  conversational: true,
  exam: EXAM_TS,
};

describe('guided flow registry', () => {
  test('every registered flow has bot state, handler path, and continue intent', () => {
    const flows = listGuidedFlows();
    assert.ok(flows.length >= 3);
    for (const flow of flows) {
      assert.ok(flow.id);
      assert.ok(flow.botState);
      assert.ok(flow.continueIntent);
      assert.equal(getGuidedFlowByBotState(flow.botState)?.id, flow.id);
      assert.equal(shouldBypassScopeFirewall({ state: flow.botState }, 'unknown'), true);
    }
  });
});

describe('guided flow interrupt policy', () => {
  const nonInterrupts = ['20000', 'BC-B', 'hello', 'hi', 'thanks', '👍', '😂', 'yes', 'no', 'AU', 'Male'];
  const interrupts = ['menu', 'home', 'main menu', 'cancel', 'stop', 'exit', 'agent', 'human'];

  for (const text of nonInterrupts) {
    test(`"${text}" is not a guided flow interrupt`, () => {
      assert.equal(isGuidedFlowInterrupt(text), false);
    });
  }

  for (const text of interrupts) {
    test(`"${text}" is a guided flow interrupt`, () => {
      assert.equal(isGuidedFlowInterrupt(text), true);
    });
  }
});

describe('guided flow orchestrator routing', () => {
  let prevScopeFirewall;
  let outboundCalls;
  let transitionLog;
  let origSearchBlog;

  function makeHooks(overrides = {}) {
    return {
      buildLeadContext: async () => ({
        phone: PHONE,
        productLine: 'iit_counselling',
        hasIit: true,
        iit: { fullName: 'Test' },
      }),
      retrieveFacts: async (_links, leadContext) => ({ lead: leadContext, links: {} }),
      getBotState: async () => ({
        state: 'college_predictor',
        context: { college: { ...COLLEGE_CTX_AFTER_EXAM } },
      }),
      transitionState: async (_cid, _phone, state, context) => {
        transitionLog.push({ state, context });
        return { state, context };
      },
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
      ...overrides,
    };
  }

  beforeEach(() => {
    prevScopeFirewall = process.env.CHATBOT_SCOPE_FIREWALL_ENABLED;
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    outboundCalls = [];
    transitionLog = [];
    origSearchBlog = faqService.searchBlog;
    faqService.searchBlog = async () => [];
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
    setChatbotOrchestratorTestHooks(makeHooks());
  });

  afterEach(() => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = prevScopeFirewall;
    faqService.searchBlog = origSearchBlog;
    setChatbotOrchestratorTestHooks(null);
    setCollegePredictorDeps({});
    setCollegePredictionIdempotencyDeps({});
  });

  test('shouldBypassScopeFirewall for all guided flow states and continue intents', () => {
    assert.equal(shouldBypassScopeFirewall({ state: 'college_predictor' }, 'unknown'), true);
    assert.equal(shouldBypassScopeFirewall({ state: 'rank_predictor' }, 'unknown'), true);
    assert.equal(shouldBypassScopeFirewall({ state: 'faq' }, 'unknown'), true);
    assert.equal(shouldBypassScopeFirewall({ state: 'main_menu' }, 'college_predictor_continue'), true);
    assert.equal(shouldBypassScopeFirewall({ state: 'main_menu' }, 'rank_predictor_continue'), true);
    assert.equal(shouldBypassScopeFirewall({ state: 'main_menu' }, 'faq'), true);
  });

  test('college_predictor: slot value routes past scope firewall', async () => {
    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'iit_counselling' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: '20000' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0].text || '';
    assert.match(text, /category|reservation/i);
    assert.doesNotMatch(text, /I'm here to help only with GuideXpert services/i);
  });

  test('college_predictor: greeting mid-flow continues slot filling', async () => {
    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'iit_counselling' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: 'hello' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0].text || '';
    assert.doesNotMatch(text, /I'm here to help only with GuideXpert services/i);
    assert.ok(
      /rank|category|reservation|enter|provide/i.test(text),
      `expected slot prompt, got: ${text}`
    );
  });

  test('college_predictor: MENU exits to main menu', async () => {
    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'iit_counselling' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: 'menu' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    assert.ok(transitionLog.some((t) => t.state === 'main_menu'));
  });

  test('rank_predictor: numeric score routes past scope firewall', async () => {
    setChatbotOrchestratorTestHooks(
      makeHooks({
        getBotState: async () => ({
          state: 'rank_predictor',
          context: { rank: { step: 'awaiting_score', examId: 'jeemainmarks' } },
        }),
      })
    );

    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'iit_counselling' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: '85' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0].text || '';
    assert.match(text, /Prediction|Rank|Percentile/i);
    assert.doesNotMatch(text, /I'm here to help only with GuideXpert services/i);
  });

  test('rank_predictor: emoji mid-flow continues', async () => {
    setChatbotOrchestratorTestHooks(
      makeHooks({
        getBotState: async () => ({
          state: 'rank_predictor',
          context: { rank: { step: 'awaiting_score', examId: 'kcet' } },
        }),
      })
    );

    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'iit_counselling' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: '👍' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    const text = outboundCalls[0].text || '';
    assert.match(text, /score|kcet/i);
    assert.doesNotMatch(text, /I'm here to help only with GuideXpert services/i);
  });

  test('faq: follow-up question in faq state routes past scope firewall', async () => {
    setChatbotOrchestratorTestHooks(
      makeHooks({
        getBotState: async () => ({ state: 'faq', context: {} }),
      })
    );

    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'iit_counselling' },
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        messageType: 'text',
        text: 'what is guidexpert',
      },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    assert.doesNotMatch(
      outboundCalls[0].text || '',
      /I'm here to help only with GuideXpert services/i
    );
  });
});

describe('guided flow handler continuity', () => {
  test('college predictor TS EAMCET → 20000 → BC-B', async () => {
    let ctx = {};
    let r = await handleCollegePredictorMessage('TS EAMCET', ctx, { isNewEntry: true });
    assert.match(r.reply, /rank/i);
    r = await handleCollegePredictorMessage('20000', r.context);
    assert.match(r.reply, /category|reservation/i);
    r = await handleCollegePredictorMessage('BC-B', r.context);
    assert.match(r.reply, /gender/i);
  });

  test('rank predictor JEE Main 85 completes', () => {
    const r = handleRankPredictorMessage('JEE Main 85', {});
    assert.match(r.reply, /Prediction/i);
    assert.equal(r.context.step, 'done');
  });
});
