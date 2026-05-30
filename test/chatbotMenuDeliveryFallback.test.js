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

describe('chatbot main menu delivery', () => {
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
          return { success: false, error: 'should not be called' };
        },
        sendBotListReply: async (args) => {
          outboundCalls.push({ type: 'list', ...args });
          return { success: false, error: 'should not be called' };
        },
      },
    });
  });

  afterEach(() => {
    setChatbotOrchestratorTestHooks(null);
  });

  test('sendMainMenu sends exactly one plain text message', async () => {
    const result = await sendMainMenu(
      makeConversation(),
      { productLine: 'iit_counselling', iit: { fullName: 'Test' } },
      new mongoose.Types.ObjectId()
    );
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0].type, 'text');
    assert.match(outboundCalls[0].text, /IIT & Engineering counselling journey/);
    assert.doesNotMatch(outboundCalls[0].text, /^Welcome$/);
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

  test('session fallback success marks inbound processed', () => {
    const update = resolveInboundProcessUpdate({
      success: true,
      outboundSuccess: true,
      delivered: true,
      sessionFallback: true,
    });
    assert.equal(update.processStatus, 'processed');
  });
});
