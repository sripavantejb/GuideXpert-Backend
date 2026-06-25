'use strict';

const { describe, test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../services/analytics/collegePredictorSearchLogger');
const demandSvc = require('../services/analytics/demandIntelligenceService');
const SearchEvent = require('../models/CollegePredictorSearchEvent');

describe('collegePredictorSearchLogger', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('extractCollegeNames maps response colleges', () => {
    const names = logger.extractCollegeNames({
      colleges: [{ college_name: 'VIT' }, { name: 'SRM' }],
    });
    assert.deepEqual(names, ['VIT', 'SRM']);
  });

  test('recordPredictorSearch skips pagination pages', async () => {
    let called = false;
    mock.method(SearchEvent, 'create', async () => {
      called = true;
      return {};
    });
    const result = await logger.recordPredictorSearch({}, {}, { colleges: [] }, 10);
    assert.equal(result, null);
    assert.equal(called, false);
  });

  test('recordPredictorSearch stores first-page search', async () => {
    mock.method(SearchEvent, 'create', async (doc) => doc);
    const result = await logger.recordPredictorSearch(
      { originalUrl: '/api/counsellor/college-predictor/colleges' },
      {
        exam: 'TNEA',
        branch_codes: ['CSE'],
        districts: ['Chennai'],
        reservation_category_codes: ['OC'],
      },
      { colleges: [{ college_name: 'Anna University' }], total_no_of_colleges: 1 },
      0
    );
    assert.equal(result.exam, 'TNEA');
    assert.equal(result.source, 'counsellor');
    assert.deepEqual(result.branchCodes, ['CSE']);
    assert.deepEqual(result.districts, ['Chennai']);
    assert.deepEqual(result.categories, ['OC']);
    assert.deepEqual(result.collegeNames, ['Anna University']);
  });
});

describe('demandIntelligenceService', () => {
  test('mergeRankedLists combines counts', () => {
    const merged = demandSvc.mergeRankedLists(
      [{ label: 'VIT', count: 3 }],
      [{ label: 'VIT', count: 2 }, { label: 'SRM', count: 1 }]
    );
    assert.equal(merged[0].label, 'VIT');
    assert.equal(merged[0].count, 5);
  });

  test('parseWindowDays accepts 7 or 30', () => {
    assert.equal(demandSvc.parseWindowDays(7), 7);
    assert.equal(demandSvc.parseWindowDays(30), 30);
    assert.equal(demandSvc.parseWindowDays(14), 7);
  });
});
