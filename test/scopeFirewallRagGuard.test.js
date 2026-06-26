'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { assertRagAllowed, refusalForRagBlock } = require('../services/chatbot/scopeFirewall/ragScopeGuard');
const { evaluateInboundScope } = require('../services/chatbot/scopeFirewall/scopeIntentGate');
const { STANDARD_REFUSAL_EN } = require('../constants/scopeFirewallReplies');

describe('ragScopeGuard', () => {
  test('blocks when scope intent is denied', () => {
    const result = assertRagAllowed({
      scopeResult: { allowed: false, intent: 'PROGRAMMING' },
      knowledgeResults: [{ id: '1', answer: 'fake chunk' }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'intent_blocked');
  });

  test('blocks empty knowledge results', () => {
    const result = assertRagAllowed({
      scopeResult: { allowed: true, intent: 'GUIDEXPERT' },
      knowledgeResults: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_grounding');
  });

  test('allows grounded retrieval for allowed intents', () => {
    const result = assertRagAllowed({
      scopeResult: { allowed: true, intent: 'IIT_COUNSELLING' },
      knowledgeResults: [{ id: 'kb-1', answer: 'JoSAA rounds' }],
    });
    assert.equal(result.ok, true);
  });

  test('refusalForRagBlock returns standard copy', () => {
    assert.equal(refusalForRagBlock('no_grounding', 'en'), STANDARD_REFUSAL_EN);
  });

  test('programming intent blocks even with KB hits', () => {
    const result = assertRagAllowed({
      intent: 'PROGRAMMING',
      knowledgeResults: [{ id: 'x', answer: 'sorting algorithm' }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'intent_blocked');
  });
});

describe('rag guard + inbound scope integration', () => {
  const saved = process.env.CHATBOT_SCOPE_FIREWALL_ENABLED;

  test('python sorting is blocked before RAG', async () => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    const scope = await evaluateInboundScope({
      originalText: 'give me a python code for sorting',
      englishMessage: 'give me a python code for sorting',
    });
    assert.equal(scope.allowed, false);
    assert.equal(scope.intent, 'PROGRAMMING');
    const rag = assertRagAllowed({ scopeResult: scope, knowledgeResults: [{ id: '1' }] });
    assert.equal(rag.ok, false);
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = saved;
  });
});
