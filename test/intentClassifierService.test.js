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
