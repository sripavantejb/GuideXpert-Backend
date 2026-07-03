'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractSlotsFromMessage,
  parseExamFromText,
  parsePositiveIntRank,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorSlotExtractor');
const { EXAM_TS, EXAM_AP, EXAM_JEE_MAIN } = require('../constants/whatsappCollegePredictor');
const { getMissingSlots } = require('../services/chatbot/whatsappCollegePredictor/collegePredictorSlots');

describe('collegePredictorSlotExtractor', () => {
  test('parseExamFromText handles aliases', () => {
    assert.equal(parseExamFromText('ts eamcet', 'exam'), EXAM_TS);
    assert.equal(parseExamFromText('EAMCET Telangana', 'exam'), EXAM_TS);
    assert.equal(parseExamFromText('I wrote AP EAMCET', 'exam'), EXAM_AP);
  });

  test('parsePositiveIntRank handles natural phrasing', () => {
    assert.equal(parsePositiveIntRank('My rank is 18453'), 18453);
    assert.equal(parsePositiveIntRank('18453 rank'), 18453);
    assert.equal(parsePositiveIntRank('I got 18453 in TS EAMCET'), 18453);
    assert.equal(parsePositiveIntRank('JEE Main AIR 24000'), 24000);
    assert.equal(parsePositiveIntRank('Rank: 15,000'), 15000);
    assert.equal(parsePositiveIntRank('15k'), 15000);
    assert.equal(parsePositiveIntRank('abc'), null);
  });

  test('parseExamFromText handles common typos', () => {
    assert.equal(parseExamFromText('TSEMCET', 'exam'), EXAM_TS);
    assert.equal(parseExamFromText('TS emcet', 'exam'), EXAM_TS);
    assert.equal(parseExamFromText('jee', 'exam'), EXAM_JEE_MAIN);
  });

  test('extractSlotsFromMessage fills multiple slots from one sentence', () => {
    const slots = extractSlotsFromMessage('TS EAMCET rank 18453 BC-B male', {});
    assert.equal(slots.exam, EXAM_TS);
    assert.equal(slots.rank, 18453);
    assert.equal(slots.categoryLabel, 'BC-B');
    assert.equal(slots.gender, 'male');
    assert.deepEqual(getMissingSlots({ flow: 'college_predictor', ...slots }), []);
  });
});
