'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateScope,
  isOutOfDomain,
} = require('../services/chatbot/scopeFirewall/scopeFirewallService');

describe('scopeFirewallService.evaluateScope', () => {
  const blockedSamples = [
    ['programming', 'Write Python code for sorting'],
    ['programming', 'Implement a binary tree in Java'],
    ['programming', 'Can you debug this function for me?'],
    ['image_generation', 'Generate an image of a dog'],
    ['image_generation', 'Draw a picture of a sunset'],
    ['weather', 'What is the weather today?'],
    ['weather', 'Tell me the temperature in Delhi'],
    ['movies', 'Tell me about Avengers movie'],
    ['movies', 'Who is the best actor right now?'],
    ['sports', 'What is the IPL score today?'],
    ['politics', 'Who will win the next election?'],
    ['finance', 'Should I buy bitcoin or mutual funds?'],
  ];

  for (const [category, text] of blockedSamples) {
    test(`blocks ${category}: "${text}"`, () => {
      const result = evaluateScope({ originalText: text });
      assert.equal(result.allowed, false, `expected "${text}" to be blocked`);
      assert.equal(result.category, category);
      assert.equal(result.reason, 'deny_pattern');
    });
  }

  const allowedSamples = [
    'Which branch is good for me?',
    'Can I get CSE in IIT Hyderabad with rank 3500?',
    'What is JoSAA?',
    'Tell me about CSAB special rounds',
    'What are the hostel fees at NIT Trichy?',
    'How do float, freeze and slide work in counselling?',
  ];

  for (const text of allowedSamples) {
    test(`allows in-domain: "${text}"`, () => {
      const result = evaluateScope({ originalText: text });
      assert.equal(result.allowed, true, `expected "${text}" to be allowed`);
    });
  }

  test('counselling segment allowed when python mention split by but', () => {
    const result = evaluateScope({
      originalText: 'I like Python but I want CSE in IIT',
    });
    assert.equal(result.partialAllowed, true);
    assert.ok(result.counsellingSegments.some((s) => /cse in iit/i.test(s)));
    assert.ok(result.blockedSegments.some((s) => s.category === 'programming'));
  });

  test('uses englishMessage candidate when original is non-English', () => {
    const result = evaluateScope({
      originalText: 'mujhe python code chahiye',
      englishMessage: 'I want python code',
    });
    assert.equal(result.allowed, false);
    assert.equal(result.category, 'programming');
  });

  test('returns a valid result when intent/botState omitted', () => {
    const result = evaluateScope({ originalText: 'What is the weather today?' });
    assert.equal(result.allowed, false);
    assert.ok(result.category);
    assert.ok(result.reason);
  });

  test('empty message is allowed (firewall does not handle empties)', () => {
    const result = evaluateScope({ originalText: '   ' });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, 'empty_message');
  });

  test('neutral message with no deny and no signal passes', () => {
    const result = evaluateScope({ originalText: 'Hello, can you help me?' });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, 'no_deny_match');
  });
});

describe('scopeFirewallService.isOutOfDomain', () => {
  test('true for out-of-domain text', () => {
    assert.equal(isOutOfDomain('Write Python code for sorting'), true);
  });

  test('false for in-domain text', () => {
    assert.equal(isOutOfDomain('Can I get CSE in IIT with rank 3500?'), false);
  });
});
