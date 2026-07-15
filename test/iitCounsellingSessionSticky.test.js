'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  resolveIitContextExpansion,
  isIitCounsellingEntryRequest,
} = require('../services/chatbot/iitCounsellingExpert/iitCounsellingIntentService');
const {
  shouldDeferFoundationForIit,
  shouldBypassScopeFirewallForIit,
  resolveIitSessionTurn,
} = require('../services/chatbot/iitCounsellingExpert/iitCounsellingSessionService');

describe('Section B V2 IIT sticky session + entry priority', () => {
  let savedFlag;

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    else process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = savedFlag;
  });

  test('IIT entry phrases route to ICE not CPA or counselling_support', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';

    for (const u of [
      'I need IIT counselling',
      'IIT counselling',
      'Help me with IIT counselling',
      'Guide me for IIT',
      'I want IIT admission',
      'JoSAA help',
      'I cracked JEE',
      'I qualified Advanced',
      'Can you guide me?',
    ]) {
      const r = classifyIntent(u, null, 'iit_counselling', u);
      assert.equal(r.intent, 'iit_counselling_expert', u);
      assert.ok(isIitCounsellingEntryRequest(u) || r.intentReason === 'iit_counselling_question', u);
    }
  });

  test('CPA still owns explicit program service questions', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const r = classifyIntent(
      'Do you provide IIT counselling?',
      null,
      'unknown',
      'Do you provide IIT counselling?'
    );
    assert.equal(r.intent, 'counsellor_program_assistant');
  });

  test('context resolver expands Round / AIR / Documents', () => {
    assert.match(resolveIitContextExpansion('Round 2'), /Round 2/i);
    assert.match(resolveIitContextExpansion('AIR 500'), /AIR 500/i);
    assert.match(resolveIitContextExpansion('Documents'), /documents.*JoSAA/i);
    assert.match(resolveIitContextExpansion('Withdrawal'), /withdrawal.*JoSAA/i);
  });

  test('sticky session defers foundation and bypasses scope for Round 1', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const botState = { context: { iitCounsellingExpertActive: true } };
    assert.equal(shouldDeferFoundationForIit('Round 1', 'Round 1', botState, 'iit_counselling'), true);
    assert.equal(
      shouldBypassScopeFirewallForIit(botState, 'Round 1', 'Round 1', 'iit_counselling_expert'),
      true
    );
    assert.equal(
      shouldBypassScopeFirewallForIit(botState, 'Teach me Python', 'Teach me Python', 'iit_counselling_expert'),
      false
    );
  });

  test('cold short topics on iit productLine defer foundation', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    assert.equal(
      shouldDeferFoundationForIit('Documents', 'Documents', { context: {} }, 'iit_counselling'),
      true
    );
    assert.equal(
      shouldDeferFoundationForIit('Documents', 'Documents', { context: {} }, 'guidexpert'),
      false
    );
  });

  test('session exit returns main_menu intent', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const botState = { context: { iitCounsellingExpertActive: true } };
    const r = classifyIntent('Main menu', botState, 'iit_counselling', 'Main menu');
    assert.equal(r.intent, 'main_menu');
  });

  test('resolveIitSessionTurn bypasses scope for mock allotment', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const turn = resolveIitSessionTurn({
      text: 'Mock Allotment',
      originalText: 'Mock Allotment',
      botState: { context: { iitCounsellingExpertActive: true } },
      intent: 'iit_counselling_expert',
    });
    assert.equal(turn.bypassScope, true);
    assert.ok(turn.expandedText);
  });
});
