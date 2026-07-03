'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  processInbound,
  buildMainMenuListSections,
  mapMenuIdToIntent,
  setChatbotOrchestratorTestHooks,
} = require('../services/chatbot/chatbotOrchestratorService');
const { retrieveFacts } = require('../services/chatbot/knowledgeRetrievalService');
const { buildAssignedExpertReply } = require('../services/chatbot/leadContextService');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const INBOUND_ID = new mongoose.Types.ObjectId();

const IIT_LEAD_CONTEXT = {
  phone: '9876543210',
  productLine: 'iit_counselling',
  hasIit: true,
  hasGx: false,
  iit: {
    fullName: 'Priya Sharma',
    slotBooking: 'Saturday 6 PM',
    slotInstantLabel: 'Sat, 7 Jun, 6:00 pm',
    preferredLanguage: 'Telugu',
    assignedBdaName: 'Ravi Kumar',
  },
  gx: null,
  meetingLink: 'https://meet.example.com/demo',
  iitPageUrl: 'https://www.guidexpert.co.in/iit-counselling',
};

function makeConversation(productLine = 'iit_counselling') {
  return {
    _id: CONVERSATION_ID,
    phone: '9876543210',
    productLine,
    status: 'active',
  };
}

function makeInbound(overrides = {}) {
  return {
    _id: INBOUND_ID,
    messageType: 'text',
    text: 'menu',
    interactivePayload: null,
    ...overrides,
  };
}

describe('chatbotOrchestrator integration', () => {
  let outboundCalls;
  let buildLeadContextCalls;
  let transitionCalls;

  beforeEach(() => {
    outboundCalls = [];
    buildLeadContextCalls = 0;
    transitionCalls = [];

    setChatbotOrchestratorTestHooks({
      buildLeadContext: async () => {
        buildLeadContextCalls += 1;
        return { ...IIT_LEAD_CONTEXT };
      },
      retrieveFacts: async (_links, leadContext) => ({
        lead: leadContext,
        links: { demoMeeting: IIT_LEAD_CONTEXT.meetingLink },
      }),
      getBotState: async () => ({ state: 'main_menu', context: {} }),
      transitionState: async (_cid, _phone, state, context) => {
        transitionCalls.push({ state, context });
        return { state, context };
      },
      isBotPausedForConversation: async () => false,
      cancelActiveHandoffForUser: async () => ({ cancelled: false }),
      createHandoff: async () => ({ _id: new mongoose.Types.ObjectId() }),
      updateConversationIntent: async () => {},
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push({ type: 'text', ...args });
          return { success: true };
        },
        sendBotButtonReply: async (args) => {
          outboundCalls.push({ type: 'button', ...args });
          return { success: true };
        },
        sendBotListReply: async (args) => {
          outboundCalls.push({ type: 'list', ...args });
          return { success: true };
        },
      },
    });

  });

  afterEach(() => {
    setChatbotOrchestratorTestHooks(null);
  });

  test('MENU loads lead context once per inbound', async () => {
    await processInbound({
      conversation: makeConversation(),
      inbound: makeInbound({ text: 'menu' }),
      leadLinks: { phone10: '9876543210', productLine: 'iit_counselling' },
    });
    assert.equal(buildLeadContextCalls, 1);
  });

  test('IIT MENU sends plain text menu', async () => {
    await processInbound({
      conversation: makeConversation(),
      inbound: makeInbound({ text: 'menu' }),
      leadLinks: { phone10: '9876543210', productLine: 'iit_counselling' },
    });
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0].type, 'text');
    assert.match(outboundCalls[0].text, /College Predictor/);
    assert.match(outboundCalls[0].text, /My Counselling Details/);
  });

  test('IIT list selection menu_5 starts college predictor flow', async () => {
    await processInbound({
      conversation: makeConversation(),
      inbound: makeInbound({
        messageType: 'list_reply',
        text: 'College Predictor',
        interactivePayload: { id: 'menu_5', title: 'College Predictor' },
      }),
      leadLinks: { phone10: '9876543210', productLine: 'iit_counselling' },
    });
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0].type, 'text');
    assert.match(outboundCalls[0].text, /Sure! I can help you predict colleges/i);
    assert.match(outboundCalls[0].text, /Which entrance exam did you write/i);
    assert.equal(transitionCalls.at(-1).state, 'college_predictor');
  });

  test('IIT digit 3 routes to assigned expert reply', async () => {
    await processInbound({
      conversation: makeConversation(),
      inbound: makeInbound({ text: '3' }),
      leadLinks: { phone10: '9876543210', productLine: 'iit_counselling' },
    });
    assert.equal(outboundCalls.length, 1);
    assert.match(outboundCalls[0].text, /assigned IIT counselling expert is Ravi Kumar/i);
    assert.equal(transitionCalls.at(-1).state, 'assigned_expert');
  });

  test('IIT list selection menu_3 routes to assigned expert reply', async () => {
    await processInbound({
      conversation: makeConversation(),
      inbound: makeInbound({
        messageType: 'list_reply',
        text: 'Assigned Expert',
        interactivePayload: { id: 'menu_3', title: 'Assigned Expert' },
      }),
      leadLinks: { phone10: '9876543210', productLine: 'iit_counselling' },
    });
    assert.match(outboundCalls[0].text, /Ravi Kumar/);
  });

  test('rank predictor menu digit uses mocked outbound', async () => {
    await processInbound({
      conversation: makeConversation(),
      inbound: makeInbound({ text: '4' }),
      leadLinks: { phone10: '9876543210', productLine: 'iit_counselling' },
    });
    assert.equal(outboundCalls.length, 1);
    assert.match(outboundCalls[0].text, /Send your|Which exam|score/i);
  });
});

describe('chatbotOrchestrator menu mapping', () => {
  test('IIT menu list includes college predictor row', () => {
    const rows = buildMainMenuListSections()[0].rows;
    assert.ok(rows.some((r) => r.id === 'menu_5' && /College Predictor/i.test(r.title)));
  });

  test('IIT digit 3 is assigned_expert intent', () => {
    assert.equal(classifyIntent('3', null, 'iit_counselling').intent, 'assigned_expert');
  });

  test('mapMenuIdToIntent menu_5 is college_predictor for IIT', () => {
    assert.equal(mapMenuIdToIntent('menu_5', 'iit_counselling'), 'college_predictor');
  });
});

describe('lead loading dedupe', () => {
  test('retrieveFacts reuses provided leadContext without reloading', async () => {
    let calls = 0;
    const leadContextService = require('../services/chatbot/leadContextService');
    const original = leadContextService.buildLeadContext;
    leadContextService.buildLeadContext = async () => {
      calls += 1;
      return IIT_LEAD_CONTEXT;
    };
    try {
      const facts = await retrieveFacts({ phone10: '9876543210' }, IIT_LEAD_CONTEXT);
      assert.equal(calls, 0);
      assert.equal(facts.lead.iit.fullName, 'Priya Sharma');
    } finally {
      leadContextService.buildLeadContext = original;
    }
  });
});

describe('assigned expert reply', () => {
  test('shows counsellor name when assigned', () => {
    const reply = buildAssignedExpertReply(IIT_LEAD_CONTEXT);
    assert.match(reply, /Ravi Kumar/);
  });

  test('handles unassigned counsellor', () => {
    const reply = buildAssignedExpertReply({
      ...IIT_LEAD_CONTEXT,
      iit: { ...IIT_LEAD_CONTEXT.iit, assignedBdaName: null },
    });
    assert.match(reply, /will be confirmed shortly/i);
  });
});
