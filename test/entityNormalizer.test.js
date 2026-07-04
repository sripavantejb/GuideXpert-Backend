'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEntity,
  normalizeEntityValue,
  compactToken,
} = require('../services/chatbot/entityNormalization/entityNormalizer');

// Load all definitions
require('../services/chatbot/entityNormalization/entityDefinitions');

describe('EntityNormalizer — ap_ts_category', () => {
  const TYPE = 'ap_ts_category';

  const CASES = [
    // ---- OC ----
    ['OC', 'OC'],
    ['oc', 'OC'],
    ['Oc', 'OC'],
    ['open', 'OC'],
    ['Open Category', 'OC'],
    ['general', 'OC'],
    ['General Category', 'OC'],
    ['I belong to OC', 'OC'],
    ['I am OC', 'OC'],
    ["I'm OC", 'OC'],
    ['My category is OC', 'OC'],
    ['I belong to Open Category', 'OC'],
    ['I am an Open Category student', 'OC'],
    // Telugu
    ['నేను OC', 'OC'],
    ['నా category OC', 'OC'],

    // ---- BC-A ----
    ['BC-A', 'BC-A'],
    ['bc-a', 'BC-A'],
    ['bca', 'BC-A'],
    ['BC A', 'BC-A'],
    ['BC_A', 'BC-A'],
    ['BCA', 'BC-A'],
    ['I belong to BC-A', 'BC-A'],
    ['My category is BC-A', 'BC-A'],

    // ---- BC-B ----
    ['BC-B', 'BC-B'],
    ['bc-b', 'BC-B'],
    ['BCB', 'BC-B'],
    ['bc b', 'BC-B'],
    ['BC_B', 'BC-B'],
    ['Bc-B', 'BC-B'],
    ['bcB', 'BC-B'],
    ['I belong to BC-B', 'BC-B'],
    ['My reservation category is BC-B', 'BC-B'],
    ["I'm from BC-B", 'BC-B'],
    ['BC-B category', 'BC-B'],
    // Telugu
    ['నేను BC-B', 'BC-B'],
    ['నా category BC-B', 'BC-B'],
    // Hinglish
    ['main BC-B hoon', 'BC-B'],
    ['mera category BC-B hai', 'BC-B'],

    // ---- BC-C ----
    ['BC-C', 'BC-C'],
    ['bcc', 'BC-C'],
    ['BC C', 'BC-C'],

    // ---- BC-D ----
    ['BC-D', 'BC-D'],
    ['bcd', 'BC-D'],
    ['BC D', 'BC-D'],

    // ---- BC-E ----
    ['BC-E', 'BC-E'],
    ['bce', 'BC-E'],

    // ---- SC ----
    ['SC', 'SC'],
    ['sc', 'SC'],
    ['Scheduled Caste', 'SC'],
    ['I come under SC', 'SC'],
    ['I am SC', 'SC'],
    ['నేను SC కి చెందాను', 'SC'],

    // ---- ST ----
    ['ST', 'ST'],
    ['st', 'ST'],
    ['Scheduled Tribe', 'ST'],
    ['I belong to ST category', 'ST'],

    // ---- EWS ----
    ['EWS', 'EWS'],
    ['ews', 'EWS'],
    ['Economically Weaker Section', 'EWS'],
    ['నాకు EWS', 'EWS'],
    ['I am EWS', 'EWS'],
  ];

  for (const [input, expected] of CASES) {
    test(`"${input}" → ${expected}`, () => {
      assert.equal(normalizeEntityValue(TYPE, input), expected);
    });
  }

  const INVALID_CASES = [
    'hello',
    'I want CSE',
    '?',
    '',
    'XYZ',
    'BCBC',
    'I am not sure',
  ];

  for (const input of INVALID_CASES) {
    test(`"${input}" → null (not a category)`, () => {
      assert.equal(normalizeEntityValue(TYPE, input), null);
    });
  }
});

describe('EntityNormalizer — gender', () => {
  const TYPE = 'gender';

  const MALE = [
    'Male', 'male', 'MALE', 'm', 'M', 'Boy', 'boy',
    '1', 'Man', 'man',
    'I am male',
    'నేను male',
  ];
  const FEMALE = [
    'Female', 'female', 'FEMALE', 'f', 'F', 'Girl', 'girl',
    '2', 'Woman', 'woman',
    'I am female',
    'I am a girl',
  ];

  for (const input of MALE) {
    test(`"${input}" → male`, () => {
      assert.equal(normalizeEntityValue(TYPE, input), 'male');
    });
  }
  for (const input of FEMALE) {
    test(`"${input}" → female`, () => {
      assert.equal(normalizeEntityValue(TYPE, input), 'female');
    });
  }
});

describe('EntityNormalizer — wbjee_quota', () => {
  const TYPE = 'wbjee_quota';

  test('"All India" → all_india', () => {
    assert.equal(normalizeEntityValue(TYPE, 'All India'), 'all_india');
  });
  test('"all india" → all_india', () => {
    assert.equal(normalizeEntityValue(TYPE, 'all india'), 'all_india');
  });
  test('"AI" → all_india', () => {
    assert.equal(normalizeEntityValue(TYPE, 'AI'), 'all_india');
  });
  test('"1" → all_india', () => {
    assert.equal(normalizeEntityValue(TYPE, '1'), 'all_india');
  });
  test('"Home State" → home_state_wb', () => {
    assert.equal(normalizeEntityValue(TYPE, 'Home State'), 'home_state_wb');
  });
  test('"West Bengal" → home_state_wb', () => {
    assert.equal(normalizeEntityValue(TYPE, 'West Bengal'), 'home_state_wb');
  });
  test('"2" → home_state_wb', () => {
    assert.equal(normalizeEntityValue(TYPE, '2'), 'home_state_wb');
  });
});

describe('EntityNormalizer — ap_region', () => {
  const TYPE = 'ap_region';

  test('"AU" → AU', () => assert.equal(normalizeEntityValue(TYPE, 'AU'), 'AU'));
  test('"Andhra University" → AU', () => assert.equal(normalizeEntityValue(TYPE, 'Andhra University'), 'AU'));
  test('"SVU" → SVU', () => assert.equal(normalizeEntityValue(TYPE, 'SVU'), 'SVU'));
  test('"Sri Venkateswara" → SVU', () => assert.equal(normalizeEntityValue(TYPE, 'Sri Venkateswara'), 'SVU'));
  test('"1" → AU', () => assert.equal(normalizeEntityValue(TYPE, '1'), 'AU'));
  test('"2" → SVU', () => assert.equal(normalizeEntityValue(TYPE, '2'), 'SVU'));
});

describe('EntityNormalizer — compactToken', () => {
  test('BC-B compacts to BCB', () => assert.equal(compactToken('BC-B'), 'BCB'));
  test('BC_B compacts to BCB', () => assert.equal(compactToken('BC_B'), 'BCB'));
  test('bc b compacts to BCB', () => assert.equal(compactToken('bc b'), 'BCB'));
  test('bc  b (double space) compacts to BCB', () => assert.equal(compactToken('bc  b'), 'BCB'));
});
