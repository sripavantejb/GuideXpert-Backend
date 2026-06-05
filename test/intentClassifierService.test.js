'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');

const PRODUCT_LINE = 'iit_counselling';

describe('intentClassifierService menu false positives', () => {
  test('"they" should not match hey → not main_menu', () => {
    const r = classifyIntent('they', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });

  test('"this" should not match hi → not main_menu', () => {
    const r = classifyIntent('this', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });

  test('"what do they do" should not trigger main_menu', () => {
    const r = classifyIntent('what do they do', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });

  test('"are they available" should not trigger main_menu', () => {
    const r = classifyIntent('are they available', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });

  test('"where are they located" should not trigger main_menu', () => {
    const r = classifyIntent('where are they located', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });

  test('"ok what do they actually do" should not trigger main_menu', () => {
    const r = classifyIntent('ok what do they actually do', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });

  test('"say hello" should not trigger main_menu (whole-message greeting only)', () => {
    const r = classifyIntent('say hello', null, PRODUCT_LINE);
    assert.notEqual(r.intent, 'main_menu');
  });
});

describe('intentClassifierService menu and greetings', () => {
  test('"hello" should match main_menu', () => {
    const r = classifyIntent('hello', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
    assert.equal(r.confidence, 'high');
  });

  test('"hey" should match main_menu', () => {
    const r = classifyIntent('hey', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
  });

  test('"MENU" should match main_menu', () => {
    const r = classifyIntent('MENU', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
  });

  test('"help" should match main_menu', () => {
    const r = classifyIntent('help', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
  });

  test('"start" should match main_menu', () => {
    const r = classifyIntent('start', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
  });

  test('"please start" should match main_menu via word-boundary start', () => {
    const r = classifyIntent('please start', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
  });
});

describe('knowledge_assistant intent', () => {
  function assertKnowledgeAssistant(text) {
    const r = classifyIntent(text, null, PRODUCT_LINE);
    assert.equal(r.intent, 'knowledge_assistant');
    assert.equal(r.confidence, 'medium');
  }

  test('What is GuideXpert?', () => assertKnowledgeAssistant('What is GuideXpert?'));
  test('What do they do?', () => assertKnowledgeAssistant('What do they do?'));
  test('How much does it cost?', () => assertKnowledgeAssistant('How much does it cost?'));
  test('Tell me about IIT counselling', () =>
    assertKnowledgeAssistant('Tell me about IIT counselling'));
  test('Explain the rank predictor', () =>
    assertKnowledgeAssistant('Explain the rank predictor'));
  test('What services do you offer?', () =>
    assertKnowledgeAssistant('What services do you offer?'));
  test('ok what do they actually do', () =>
    assertKnowledgeAssistant('ok what do they actually do'));
  test('how are placements at niat routes to knowledge_assistant', () =>
    assertKnowledgeAssistant('how are placements at niat'));
  test('how is NIAT different routes to knowledge_assistant', () =>
    assertKnowledgeAssistant('how is NIAT different'));

  test('menu stays main_menu', () => {
    const r = classifyIntent('menu', null, PRODUCT_LINE);
    assert.equal(r.intent, 'main_menu');
  });

  test('agent request stays human_handoff', () => {
    const r = classifyIntent('I need an agent', null, 'unknown');
    assert.equal(r.intent, 'human_handoff');
  });

  test('digit 4 stays rank_predictor', () => {
    const r = classifyIntent('4', null, PRODUCT_LINE);
    assert.equal(r.intent, 'rank_predictor');
  });

  test('digit 5 stays college_predictor', () => {
    const r = classifyIntent('5', null, PRODUCT_LINE);
    assert.equal(r.intent, 'college_predictor');
  });

  test('digit 2 stays counselling_support', () => {
    const r = classifyIntent('2', null, PRODUCT_LINE);
    assert.equal(r.intent, 'counselling_support');
  });

  test('rank predictor without question phrase stays rank_predictor', () => {
    const r = classifyIntent('rank predictor', null, PRODUCT_LINE);
    assert.equal(r.intent, 'rank_predictor');
  });

  test('follow-up routes to knowledge_assistant when session is active', () => {
    const r = classifyIntent(
      'How is it different?',
      { state: 'idle', context: { knowledgeAssistantActive: true } },
      PRODUCT_LINE
    );
    assert.equal(r.intent, 'knowledge_assistant');
    assert.equal(r.confidence, 'medium');
  });

  test('menu clears knowledge session routing priority', () => {
    const r = classifyIntent(
      'menu',
      { state: 'idle', context: { knowledgeAssistantActive: true } },
      PRODUCT_LINE
    );
    assert.equal(r.intent, 'main_menu');
  });
});
