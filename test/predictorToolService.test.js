'use strict';

const { describe, test, mock } = require('node:test');
const assert = require('node:assert/strict');

const predictorPath = require.resolve('../services/chatbot/predictorToolService');
const corePath = require.resolve('../services/collegePredictorCore');

describe('predictorToolService', () => {
  test('detectPredictorIntent routes college vs rank', () => {
    delete require.cache[predictorPath];
    const p = require(predictorPath);
    assert.equal(p.detectPredictorIntent('can I get CSE with 45000 rank?'), 'college');
    assert.equal(p.detectPredictorIntent('predict my rank from marks'), 'rank');
    assert.equal(p.detectPredictorIntent('hello'), null);
  });

  test('buildCollegeSlotsFromProfile seeds exam and rank', () => {
    delete require.cache[predictorPath];
    const p = require(predictorPath);
    const slots = p.buildCollegeSlotsFromProfile({
      exam: 'TS EAMCET',
      rank: 45000,
      gender: 'male',
    });
    assert.equal(slots.exam, 'TS_EAMCET');
    assert.equal(slots.rank, 45000);
    assert.equal(slots.gender, 'male');
  });

  test('mergeCollegeSlots fills from free text and checklist stays incomplete without category/gender', () => {
    delete require.cache[predictorPath];
    const p = require(predictorPath);
    const slots = p.mergeCollegeSlots({
      slots: {},
      userText: 'I got 45000 rank in TS EAMCET',
      llmPatch: {},
    });
    assert.equal(slots.exam, 'TS_EAMCET');
    assert.equal(slots.rank, 45000);
    const meta = p.nextMissingPromptMeta({ type: 'college', slots, active: true });
    assert.ok(meta.missing.includes('category') || meta.missing.includes('gender'));
    assert.equal(meta.ready, false);
    assert.match(p.buildPredictorChecklistBlock({ type: 'college', slots, active: true }), /PREDICTOR_CHECKLIST/);
  });

  test('rank checklist requires difficulty for MHT CET', () => {
    delete require.cache[predictorPath];
    const p = require(predictorPath);
    const slots = { examId: 'mhcet', score: 150 };
    assert.deepEqual(p.getRankMissingSlots(slots), ['difficulty']);
    assert.equal(p.isRankReady(slots), false);
    assert.equal(p.isRankReady({ ...slots, difficulty: 'Moderate' }), true);
  });

  test('runCollegePrediction formats grounded colleges from mocked core', async () => {
    delete require.cache[corePath];
    delete require.cache[predictorPath];
    const core = require(corePath);
    mock.method(core, 'fetchCollegeDostColleges', async () => ({
      colleges: [
        {
          college_name: 'Test College',
          branches: [
            {
              branch_name: 'CSE',
              reservation_categories: [{ cutoff_rank: 40000, category_name: 'OC BOYS' }],
            },
          ],
        },
      ],
    }));
    delete require.cache[predictorPath];
    const p = require(predictorPath);

    const result = await p.runCollegePrediction({
      exam: 'TS_EAMCET',
      rank: 45000,
      categoryN: 1,
      categoryLabel: 'OC',
      gender: 'male',
      baseCategory: 'OC',
    });

    assert.equal(result.ok, true);
    assert.match(result.reply, /Test College/);
    assert.match(result.reply, /CSE/);
    assert.doesNotMatch(result.reply, /MENU ->/);
    mock.restoreAll();
  });

  test('runRankPrediction returns range text for TS EAMCET score', async () => {
    delete require.cache[predictorPath];
    const p = require(predictorPath);
    const result = await p.runRankPrediction({ examId: 'tseamcet', score: 120 });
    assert.equal(result.ok, true);
    assert.match(result.reply, /TS EAMCET/i);
    assert.match(result.reply, /Predicted Rank/i);
  });

  test('AP OC male is blocked before upstream call', async () => {
    delete require.cache[predictorPath];
    const p = require(predictorPath);
    // categoryN 1 is typically OC in AP_TS options — verify via isApOcMaleBlocked path
    const { AP_TS_CATEGORY_OPTIONS, isApOcMaleBlocked } = require('../services/chatbot/whatsappCollegePredictor/apTs');
    const oc = AP_TS_CATEGORY_OPTIONS.find((c) => /OC/i.test(c.label) && !/BC/i.test(c.label));
    assert.ok(oc);
    assert.equal(isApOcMaleBlocked(oc.id, 'male'), true);
    const result = await p.runCollegePrediction({
      exam: 'AP_EAMCET',
      rank: 10000,
      categoryN: oc.id,
      categoryLabel: oc.label,
      gender: 'male',
    });
    assert.equal(result.blocked, true);
    assert.match(result.reply, /AP EAMCET/i);
  });
});
