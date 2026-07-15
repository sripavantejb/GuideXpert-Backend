'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent, shouldBypassScopeFirewall } = require('../services/chatbot/intentClassifierService');
const {
  isJeeMainEntry,
  isJeeAdvancedEntry,
  isJeeAmbiguousEntry,
  isCommerceOutOfScopeRequest,
  shouldBypassScopeFirewallForJee,
  resolveJeeContextExpansion,
  shouldDeferFoundationForJee,
} = require('../services/chatbot/jeeCounselling/jeeCounsellingSessionService');

describe('Section C V2 JEE sticky session + Main/Advanced + shopping', () => {
  let savedFlag;

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    else process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = savedFlag;
  });

  test('JEE Main entry routes to ICE, not unknown/CPA', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    for (const u of ['I wrote JEE Main', 'I wrote JEE Mains', 'JEE Main', 'cleared JEE Main']) {
      assert.equal(isJeeMainEntry(u), true, u);
      const r = classifyIntent(u, null, 'iit_counselling', u);
      assert.equal(r.intent, 'iit_counselling_expert', u);
      assert.equal(r.intentReason, 'jee_main_entry', u);
    }
  });

  test('JEE Advanced entry routes to ICE', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    for (const u of ['I wrote JEE Advanced', 'JEE Advanced', 'Need IIT admission']) {
      assert.equal(isJeeAdvancedEntry(u), true, u);
      const r = classifyIntent(u, null, 'iit_counselling', u);
      assert.equal(r.intent, 'iit_counselling_expert', u);
      assert.equal(r.intentReason, 'jee_advanced_entry', u);
    }
  });

  test('ambiguous JEE asks Main vs Advanced', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    for (const u of ['JEE', 'Help me with JEE', 'JEE counselling', 'I cleared JEE']) {
      assert.equal(isJeeAmbiguousEntry(u), true, u);
      const r = classifyIntent(u, null, 'iit_counselling', u);
      assert.equal(r.intent, 'jee_exam_clarify', u);
    }
  });

  test('eligibility and reservation topics route to ICE and bypass scope', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    for (const u of [
      'Age limit',
      'Attempt limit',
      'Reservation policy',
      'General Female',
      'OBC Female',
      'Why are there two exams?',
    ]) {
      const r = classifyIntent(u, null, 'iit_counselling', u);
      assert.equal(r.intent, 'iit_counselling_expert', u);
      assert.equal(shouldBypassScopeFirewall(null, r.intent, u, u), true, u);
      assert.ok(resolveJeeContextExpansion(u) || shouldBypassScopeFirewallForJee(null, u, u, r.intent), u);
    }
  });

  test('sticky JEE session owns follow-ups', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const botState = {
      context: { jeeCounsellingActive: true, currentJourney: 'JEE_COUNSELLING' },
    };
    assert.equal(shouldDeferFoundationForJee('Quota', 'Quota', botState, 'iit_counselling'), true);
    const r = classifyIntent('Female quota', botState, 'iit_counselling', 'Female quota');
    assert.equal(r.intent, 'iit_counselling_expert');
    assert.equal(shouldBypassScopeFirewall(botState, r.intent, 'Female quota', 'Female quota'), true);
  });

  test('shopping never becomes FAQ and never bypasses firewall', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const u = 'Help me shop on Amazon';
    assert.equal(isCommerceOutOfScopeRequest(u), true);
    const r = classifyIntent(u, null, 'iit_counselling', u);
    assert.notEqual(r.intent, 'faq');
    assert.equal(r.intentReason, 'commerce_out_of_scope');
    assert.equal(shouldBypassScopeFirewall(null, 'faq', u, u), false);
    assert.equal(shouldBypassScopeFirewallForJee({ context: { jeeCounsellingActive: true } }, u, u, 'iit_counselling_expert'), false);
  });

  test('strategy questions bypass scope', () => {
    savedFlag = process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED;
    process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED = '1';
    const u = 'AIR 8000 General Can I get NIT?';
    assert.equal(
      shouldBypassScopeFirewall(null, 'iit_counselling_strategy', u, u),
      true
    );
  });
});
