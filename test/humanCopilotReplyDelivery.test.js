'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const replyPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotReplyService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const outboundPath = require.resolve('../services/chatbot/whatsappOutboundService');
const handoffServicePath = require.resolve('../services/chatbot/handoffService');

const HANDOFF_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
const CONVERSATION_ID = new mongoose.Types.ObjectId();
const REPLY_ID = new mongoose.Types.ObjectId();

describe('humanCopilot reply delivery', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[replyPath];
  });

  function sampleHandoff(overrides = {}) {
    return {
      _id: HANDOFF_ID,
      conversationId: CONVERSATION_ID,
      phone: '9876543210',
      route: 'admin_pool',
      status: 'open',
      lockVersion: 1,
      assignedSrCounsellor: 'sr1',
      copilotReplies: [],
      ...overrides,
    };
  }

  test('sendCopilotReply marks reply sent on WhatsApp success', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const createdHandoff = sampleHandoff({
      lockVersion: 2,
      copilotReplies: [{ _id: REPLY_ID, draftText: 'Hello', status: 'sending' }],
    });
    let learningPatch = null;

    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => sampleHandoff(),
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', (filter, update) => {
      const set = update?.$set || {};
      if (set['copilotReplies.$.status'] === 'sent') {
        learningPatch = set;
      }
      return { lean: async () => createdHandoff };
    });
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const handoffService = require(handoffServicePath);
    mock.method(handoffService, 'claimHandoff', async () => ({ success: true }));

    const outbound = require(outboundPath);
    mock.method(outbound, 'sendAgentTextReply', async () => ({
      success: true,
      outboundId: new mongoose.Types.ObjectId(),
    }));

    delete require.cache[replyPath];
    const { sendCopilotReply } = require(replyPath);
    const result = await sendCopilotReply(HANDOFF_ID, ADMIN_ID, 'Hello there', { lockVersion: 1 });
    assert.equal(result.success, true);
    assert.equal(result.deliveryStatus, 'sent');
    assert.ok(result.replyId);
    assert.equal(learningPatch?.['copilotReplies.$.editClassification'], 'manual');
  });

  test('sendCopilotReply persists learning fields for edited AI suggestions', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const createdHandoff = sampleHandoff({
      lockVersion: 2,
      copilotReplies: [{ _id: REPLY_ID, draftText: 'Hello', status: 'sending' }],
    });
    let learningPatch = null;

    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => sampleHandoff(),
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', (filter, update) => {
      const set = update?.$set || {};
      if (set['copilotReplies.$.status'] === 'sent') {
        learningPatch = set;
      }
      return { lean: async () => createdHandoff };
    });
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const handoffService = require(handoffServicePath);
    mock.method(handoffService, 'claimHandoff', async () => ({ success: true }));

    const outbound = require(outboundPath);
    mock.method(outbound, 'sendAgentTextReply', async () => ({
      success: true,
      outboundId: new mongoose.Types.ObjectId(),
    }));

    delete require.cache[replyPath];
    const { sendCopilotReply } = require(replyPath);
    const suggested = 'College X is suitable for your profile.';
    const finalText = 'College X may be suitable for your profile and hostel.';
    const result = await sendCopilotReply(HANDOFF_ID, ADMIN_ID, finalText, {
      lockVersion: 1,
      suggestedText: suggested,
      replySource: 'ai_edited',
    });
    assert.equal(result.success, true);
    assert.equal(learningPatch?.['copilotReplies.$.editClassification'], 'moderate_edit');
    assert.ok(learningPatch?.['copilotReplies.$.editRatio'] > 0);
    assert.equal(learningPatch?.['copilotReplies.$.editTopic'], 'hostel');
    assert.ok(Array.isArray(learningPatch?.['copilotReplies.$.editPatterns']));
  });

  test('sendCopilotReply preserves draft and marks failed on WhatsApp error', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const createdHandoff = sampleHandoff({
      lockVersion: 2,
      copilotReplies: [{ _id: REPLY_ID, draftText: 'Hello', status: 'sending' }],
    });

    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => sampleHandoff(),
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', () => ({
      lean: async () => createdHandoff,
    }));
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const handoffService = require(handoffServicePath);
    mock.method(handoffService, 'claimHandoff', async () => ({ success: true }));

    const outbound = require(outboundPath);
    mock.method(outbound, 'sendAgentTextReply', async () => ({
      success: false,
      error: 'provider_timeout',
    }));

    delete require.cache[replyPath];
    const { sendCopilotReply } = require(replyPath);
    const result = await sendCopilotReply(HANDOFF_ID, ADMIN_ID, 'Hello there', { lockVersion: 1 });
    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'failed');
    assert.equal(result.draftText, 'Hello there');
    assert.match(result.message, /provider_timeout|send_failed/);
  });

  test('classifyReplySource distinguishes manual, ai_used, ai_edited', () => {
    const { classifyReplySource } = require(replyPath);
    assert.equal(classifyReplySource({ text: 'Hi', suggestedText: null }), 'manual');
    assert.equal(classifyReplySource({ text: 'Hi', suggestedText: 'Hi' }), 'ai_used');
    assert.equal(classifyReplySource({ text: 'Hi!', suggestedText: 'Hi' }), 'ai_edited');
  });

  test('normalizeSuggestedText coerces suggestion objects to string', () => {
    const { normalizeSuggestedText } = require(replyPath);
    assert.equal(
      normalizeSuggestedText({ text: 'Hello from AI', model: 'gpt' }),
      'Hello from AI'
    );
    assert.equal(normalizeSuggestedText('  plain  '), 'plain');
    assert.equal(normalizeSuggestedText(null), null);
  });

  test('sendCopilotReply accepts suggestedText object without CastError', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const createdHandoff = sampleHandoff({
      lockVersion: 2,
      copilotReplies: [{ _id: REPLY_ID, draftText: 'Hello', status: 'sending' }],
    });
    let storedSuggested = null;

    mock.method(WhatsAppAgentHandoff, 'findById', () => ({
      lean: async () => sampleHandoff(),
    }));
    mock.method(WhatsAppAgentHandoff, 'findOneAndUpdate', (filter, update) => {
      const push = update?.$push?.copilotReplies;
      if (push?.suggestedText) storedSuggested = push.suggestedText;
      const set = update?.$set || {};
      if (set['copilotReplies.$.status'] === 'sent') {
        storedSuggested = storedSuggested || set['copilotReplies.$.suggestedText'];
      }
      return { lean: async () => createdHandoff };
    });
    mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const handoffService = require(handoffServicePath);
    mock.method(handoffService, 'claimHandoff', async () => ({ success: true }));

    const outbound = require(outboundPath);
    mock.method(outbound, 'sendAgentTextReply', async () => ({
      success: true,
      outboundId: new mongoose.Types.ObjectId(),
    }));

    delete require.cache[replyPath];
    const { sendCopilotReply } = require(replyPath);
    const result = await sendCopilotReply(HANDOFF_ID, ADMIN_ID, 'Hello there', {
      lockVersion: 1,
      suggestedText: { text: 'Hello there', model: 'openai/gpt-oss-20b' },
      replySource: 'ai_used',
    });
    assert.equal(result.success, true);
    assert.equal(storedSuggested, 'Hello there');
  });
});
