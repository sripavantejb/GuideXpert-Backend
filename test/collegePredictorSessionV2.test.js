'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const {
  isCollegePredictorEntryQuery,
  isShowMoreRequest,
  filterCollegesLocally,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorSessionService');
const { isGuidedFlowInterrupt } = require('../services/chatbot/guidedFlows/guidedFlowInterruptPolicy');

describe('Section D V2 College Predictor sticky + entry', () => {
  afterEach(() => {
    setCollegePredictorDeps({});
  });

  test('entry phrases route to college_predictor not knowledge', () => {
    for (const u of [
      'Predict my colleges',
      'Predict colleges',
      'College prediction',
      'Show colleges',
      'Need college prediction',
      'Which colleges can I get',
      'Can you predict colleges?',
      'I want to know which colleges I can get',
    ]) {
      assert.equal(isCollegePredictorEntryQuery(u), true, u);
      const r = classifyIntent(u, null, 'iit_counselling', u);
      assert.equal(r.intent, 'college_predictor', u);
    }
  });

  test('sticky results after prediction + show more', async () => {
    const colleges = Array.from({ length: 12 }, (_, i) => ({
      college_name: `College ${i + 1}`,
      branches: [
        {
          branch_name: i % 2 ? 'CSE' : 'ECE',
          branch_code: i % 2 ? 'CSE' : 'ECE',
          reservation_categories: [{ cutoff_rank: 1000 + i }],
        },
      ],
    }));
    setCollegePredictorDeps({
      getPredictedColleges: async (_e, offset, limit) => ({
        colleges: colleges.slice(offset, offset + limit),
        total_no_of_colleges: colleges.length,
      }),
    });

    // Mirror certified happy path: exam digit → rank → category digit → gender digit
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('5200', r.context);
    r = await handleCollegePredictorMessage('4', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.clearState, false);
    assert.equal(r.context.step, 'results');
    assert.match(r.reply, /predicted colleges/i);
    assert.ok(Array.isArray(r.context.resultCache));

    assert.equal(isShowMoreRequest('Show more'), true);
    const more = await handleCollegePredictorMessage('Show more', r.context);
    assert.equal(more.context.step, 'results');
    assert.match(more.reply, /more predicted colleges|Top Matches|More Matches/i);

    const cse = await handleCollegePredictorMessage('CSE', more.context);
    assert.equal(cse.context.step, 'results');
    assert.equal(cse.context.branchFilter, 'CSE');
  });

  test('restart interrupts guided flow', () => {
    assert.equal(isGuidedFlowInterrupt('Restart'), true);
    assert.equal(isGuidedFlowInterrupt('Start over'), true);
    const r = classifyIntent('Restart', { state: 'college_predictor' }, 'iit_counselling');
    assert.equal(r.intent, 'main_menu');
  });

  test('local government filter heuristics', () => {
    const list = [
      { college_name: 'NIT Warangal' },
      { college_name: 'Some Private Institute' },
    ];
    assert.equal(filterCollegesLocally(list, { ownership: 'government' }).length, 1);
    assert.equal(filterCollegesLocally(list, { ownership: 'private' })[0].college_name, 'Some Private Institute');
  });
});
