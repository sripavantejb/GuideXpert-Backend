'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  tryFoundationConversation,
  matchCategory,
  CATEGORY,
} = require('../services/chatbot/foundationConversation/foundationConversationRouter');
const {
  isExplicitHumanHandoffRequest,
} = require('../services/chatbot/foundationConversation/humanHandoffIntent');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { isGuidedFlowInterrupt } = require('../services/chatbot/guidedFlows/guidedFlowInterruptPolicy');

describe('foundationConversationRouter', () => {
  test('greetings including variants', () => {
    for (const u of ['Hello', 'Hiiii', 'Helloo', 'Good morning', 'Namaste', 'Yo', 'Sup', "What's up", 'Hi there']) {
      const m = matchCategory(u, u);
      assert.equal(m?.category, CATEGORY.GREETING, u);
      const r = tryFoundationConversation({ text: u, originalText: u });
      assert.equal(r.handled, true);
      assert.match(r.replyText, /GuideXpert|help/i);
      assert.ok(r.durationMs < 20);
    }
  });

  test('identity never claims human', () => {
    for (const u of ['Who are you?', 'Are you ChatGPT?', 'Are you AI?', 'Are you human?', 'What is GuideXpert?']) {
      const r = tryFoundationConversation({ text: u, originalText: u });
      assert.equal(r.category, CATEGORY.IDENTITY);
      assert.doesNotMatch(r.replyText, /\bI am (a )?human\b/i);
      assert.match(r.replyText, /AI|assistant|GuideXpert/i);
    }
  });

  test('capability is deterministic', () => {
    const r = tryFoundationConversation({ text: 'What can you do?', originalText: 'What can you do?' });
    assert.equal(r.category, CATEGORY.CAPABILITY);
    assert.match(r.replyText, /College Predictor|JoSAA|Scholarship/i);
  });

  test('navigation returns clearSubflows', () => {
    const r = tryFoundationConversation({
      text: 'Support',
      originalText: 'Support',
      menuText: 'MENU TEXT',
    });
    assert.equal(r.category, CATEGORY.NAVIGATION);
    assert.equal(r.replyText, 'MENU TEXT');
    assert.equal(r.clearSubflows, true);
  });

  test('goodbye includes talk later', () => {
    const r = tryFoundationConversation({ text: 'Talk later', originalText: 'Talk later' });
    assert.equal(r.category, CATEGORY.GOODBYE);
  });

  test('clarification does not answer immediately', () => {
    const r = tryFoundationConversation({ text: 'Admission', originalText: 'Admission' });
    assert.equal(r.category, CATEGORY.CLARIFICATION);
    assert.match(r.replyText, /\?/);
  });

  test('emoji and punctuation clarify', () => {
    for (const u of ['😀', '???', ' ']) {
      const r = tryFoundationConversation({ text: u, originalText: u });
      assert.equal(r?.handled, true);
      assert.equal(r.category, CATEGORY.CLARIFICATION);
    }
  });
});

describe('humanHandoffIntent', () => {
  test('false positives never handoff', () => {
    for (const u of ['Are you human?', 'Support', 'Talk later', 'Help', 'Menu']) {
      assert.equal(isExplicitHumanHandoffRequest(u), false, u);
      assert.notEqual(classifyIntent(u, null, 'unknown', u).intent, 'human_handoff', u);
    }
  });

  test('explicit requests do handoff', () => {
    for (const u of [
      'Talk to counsellor',
      'Connect me to an agent',
      'Human support please',
      'I need a real person',
      'Escalate',
      'Call me',
    ]) {
      assert.equal(isExplicitHumanHandoffRequest(u), true, u);
      assert.equal(classifyIntent(u, null, 'unknown', u).intent, 'human_handoff', u);
    }
  });

  test('guided interrupt uses explicit handoff only', () => {
    assert.equal(isGuidedFlowInterrupt('Are you human?'), false);
    assert.equal(isGuidedFlowInterrupt('Support'), false);
    assert.equal(isGuidedFlowInterrupt('Talk later'), false);
    assert.equal(isGuidedFlowInterrupt('Talk to counsellor'), true);
    assert.equal(isGuidedFlowInterrupt('menu'), true);
  });
});
