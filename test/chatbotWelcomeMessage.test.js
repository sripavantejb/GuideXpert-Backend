'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractFirstName,
  formatWelcomeSalutation,
  buildWelcomeMenuText,
} = require('../services/chatbot/welcomeMessageService');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');

describe('welcomeMessageService', () => {
  test('extractFirstName returns first token', () => {
    assert.equal(extractFirstName('Ravi Kumar'), 'Ravi');
    assert.equal(extractFirstName('  Priya  '), 'Priya');
    assert.equal(extractFirstName(''), null);
    assert.equal(extractFirstName(null), null);
  });

  test('IIT welcome uses first name and menu options', () => {
    const text = buildWelcomeMenuText({
      productLine: 'iit_counselling',
      iit: { fullName: 'Priya Sharma' },
    });
    assert.match(text, /🎓 Hi Priya!/);
    assert.match(text, /My Counselling Details/);
    assert.match(text, /Talk to My Counsellor/);
    assert.match(text, /When is my counselling session/);
  });

  test('IIT welcome without name uses Hi there', () => {
    const text = buildWelcomeMenuText({
      productLine: 'iit_counselling',
      iit: { fullName: '' },
    });
    assert.match(text, /🎓 Hi there!/);
    assert.doesNotMatch(text, /Hi !/);
  });

  test('GuideXpert lead welcome', () => {
    const text = buildWelcomeMenuText({
      productLine: 'guidexpert',
      gx: { fullName: 'Amit Verma' },
    });
    assert.match(text, /💼 Hi Amit!/);
    assert.match(text, /Certified Career Counsellor/);
    assert.match(text, /Program Overview/);
    assert.match(text, /Talk to Our Team/);
  });

  test('GX welcome without name uses Hi there', () => {
    assert.match(
      formatWelcomeSalutation({ productLine: 'guidexpert', gx: {} }),
      /Hi there!/
    );
  });

  test('organic visitor welcome', () => {
    const text = buildWelcomeMenuText({ productLine: 'unknown' });
    assert.match(text, /👋 Welcome to GuideXpert!/);
    assert.match(text, /IIT \/ College Counselling/);
    assert.match(text, /Become a Career Counsellor/);
    assert.match(text, /Talk to an Expert/);
  });
});

describe('welcome menu digit routing', () => {
  test('IIT menu 6 is human handoff', () => {
    assert.equal(classifyIntent('6', null, 'iit_counselling').intent, 'human_handoff');
  });

  test('GX menu 2 is faq', () => {
    assert.equal(classifyIntent('2', null, 'guidexpert').intent, 'faq');
  });

  test('organic menu 1 is counselling_support', () => {
    assert.equal(classifyIntent('1', null, 'unknown').intent, 'counselling_support');
  });
});
