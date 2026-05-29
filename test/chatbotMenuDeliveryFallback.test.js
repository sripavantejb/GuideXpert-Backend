'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  sendMainMenu,
  setChatbotOrchestratorTestHooks,
} = require('../services/chatbot/chatbotOrchestratorService');
const { resolveInboundProcessUpdate } = require('../services/chatbot/whatsappInboundService');

const CONVERSATION_ID = new mongoose.Types.ObjectId();

function makeConversation() {
  return {
    _id: CONVERSATION_ID,
    phone: '9876543210',
    productLine: 'iit_counselling',
    status: 'active',
  };
}

describe('chatbot menu delivery fallback', () => {
  let outboundCalls;

  beforeEach(() => {
    outboundCalls = [];
    setChatbotOrchestratorTestHooks({
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push({ type: 'text', ...args });
          return { success: true };
        },
        sendBotButtonReply: async (args) => {
          outboundCalls.push({ type: 'button', ...args });
          return { success: false, error: 'interactive rejected' };
        },
        sendBotListReply: async (args) => {
          outboundCalls.push({ type: 'list', ...args });
          return { success: false, error: 'list rejected' };
        },
      },
    });
    process.env.CHATBOT_USE_BUTTON_MENU = '1';
    delete process.env.CHATBOT_USE_IIT_LIST_MENU;
  });

  afterEach(() => {
    delete process.env.CHATBOT_USE_BUTTON_MENU;
    delete process.env.CHATBOT_USE_IIT_LIST_MENU;
    setChatbotOrchestratorTestHooks(null);
  });

  test('button send failure falls back to plain text menu', async () => {
    const result = await sendMainMenu(
      makeConversation(),
      { productLine: 'iit_counselling', iit: { fullName: 'Test' } },
      new mongoose.Types.ObjectId()
    );
    assert.equal(outboundCalls.length, 2);
    assert.equal(outboundCalls[0].type, 'button');
    assert.equal(outboundCalls[1].type, 'text');
    assert.match(outboundCalls[1].text, /Welcome back to GuideXpert/);
    assert.equal(result.success, true);
  });

  test('list send failure falls back to button then text', async () => {
    process.env.CHATBOT_USE_IIT_LIST_MENU = '1';
    const result = await sendMainMenu(
      makeConversation(),
      { productLine: 'iit_counselling', iit: { fullName: 'Test' } },
      new mongoose.Types.ObjectId()
    );
    assert.equal(outboundCalls.length, 3);
    assert.deepEqual(
      outboundCalls.map((call) => call.type),
      ['list', 'button', 'text']
    );
    assert.equal(result.success, true);
  });
});

describe('inbound process status on delivery failure', () => {
  test('failed outbound leaves inbound pending for replay', () => {
    const update = resolveInboundProcessUpdate({ success: false, error: 'Gupshup not configured' });
    assert.equal(update.processStatus, 'pending');
    assert.match(update.processError, /Gupshup not configured/);
  });

  test('successful outbound marks inbound processed', () => {
    const update = resolveInboundProcessUpdate({ success: true, outboundSuccess: true, delivered: true });
    assert.equal(update.processStatus, 'processed');
    assert.equal(update.processError, null);
  });
});
