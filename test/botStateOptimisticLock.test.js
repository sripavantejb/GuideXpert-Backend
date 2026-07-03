'use strict';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  transitionState,
  getBotState,
  runWithOptimisticLockRetry,
  resetOptimisticLockMetrics,
  getOptimisticLockMetrics,
  OptimisticLockConflictError,
  OptimisticLockFailedError,
  MAX_OPTIMISTIC_LOCK_RETRIES,
} = require('../services/chatbot/botStateService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const { EXAM_TS } = require('../constants/whatsappCollegePredictor');

const PHONE = '9876543210';
let mongoServer;
let conversationId;

function makePredictor(callLog) {
  return async (exam, offset, limit, body) => {
    callLog.push({ exam, body: { ...body } });
    return {
      colleges: [
        {
          college_name: `College-${body.rank}`,
          branches: [{ branch_name: 'CSE', branch_code: 'CSE' }],
        },
      ],
      total_no_of_colleges: 1,
    };
  };
}

/**
 * Mirrors orchestrator college_predictor branch with real bot state persistence.
 */
async function processCollegePredictorSlot(conversationId, phone10, text, { isNewEntry = false } = {}) {
  let botState = await getBotState(conversationId);
  const contextPatch = botState?.context || {};
  await transitionState(conversationId, phone10, 'college_predictor', contextPatch);
  const collegeCtx = contextPatch.college || {};
  const result = await handleCollegePredictorMessage(text, collegeCtx, { isNewEntry });
  if (result.clearState) {
    await transitionState(conversationId, phone10, 'main_menu', { college: {} });
  } else {
    await transitionState(conversationId, phone10, 'college_predictor', { college: result.context });
  }
  return result;
}

async function processCollegePredictorSlotWithRetry(conversationId, phone10, text, opts = {}) {
  return runWithOptimisticLockRetry({
    conversationId,
    phone10,
    operation: async () => processCollegePredictorSlot(conversationId, phone10, text, opts),
  });
}

describe('botState optimistic locking', () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    conversationId = new mongoose.Types.ObjectId();
    resetOptimisticLockMetrics();
    await mongoose.connection.collection('whatsappbotstates').deleteMany({});
    setCollegePredictorDeps({});
  });

  test('CAS increments version on each update', async () => {
    await transitionState(conversationId, PHONE, 'main_menu', {});
    let state = await getBotState(conversationId);
    assert.equal(state.version, 1);

    await transitionState(conversationId, PHONE, 'college_predictor', { college: { exam: 'TS' } });
    state = await getBotState(conversationId);
    assert.equal(state.version, 2);
    assert.equal(state.state, 'college_predictor');
    assert.equal(state.context.college.exam, 'TS');
  });

  test('concurrent transitionState calls — one wins per pair, retries preserve slots', async () => {
    const results = await Promise.allSettled([
      runWithOptimisticLockRetry({
        conversationId,
        phone10: PHONE,
        operation: async () => {
          await transitionState(conversationId, PHONE, 'college_predictor', {
            college: { exam: 'TS', rank: 10001 },
          });
        },
      }),
      runWithOptimisticLockRetry({
        conversationId,
        phone10: PHONE,
        operation: async () => {
          await transitionState(conversationId, PHONE, 'college_predictor', {
            college: { exam: 'TS', rank: 10002 },
          });
        },
      }),
    ]);

    assert.equal(results.every((r) => r.status === 'fulfilled'), true);
    const final = await getBotState(conversationId);
    assert.equal(final.state, 'college_predictor');
    assert.ok(final.context.college.rank === 10001 || final.context.college.rank === 10002);
    assert.ok(final.version >= 2);
  });

  test('two simultaneous college predictor messages', async () => {
    const apiCalls = [];
    setCollegePredictorDeps({ getPredictedColleges: makePredictor(apiCalls) });

    const [r1, r2] = await Promise.all([
      processCollegePredictorSlotWithRetry(conversationId, PHONE, '2', { isNewEntry: true }),
      processCollegePredictorSlotWithRetry(conversationId, PHONE, '15000'),
    ]);

    const final = await getBotState(conversationId);
    assert.ok(r1.reply || r2.reply);
    assert.ok(final.context.college?.exam || final.state === 'main_menu');
    assert.ok(apiCalls.length <= 1, `expected at most 1 API call, got ${apiCalls.length}`);
  });

  test('three simultaneous college predictor messages', async () => {
    const apiCalls = [];
    setCollegePredictorDeps({ getPredictedColleges: makePredictor(apiCalls) });

    const outcomes = await Promise.allSettled([
      processCollegePredictorSlotWithRetry(conversationId, PHONE, '2', { isNewEntry: true }),
      processCollegePredictorSlotWithRetry(conversationId, PHONE, '15000'),
      processCollegePredictorSlotWithRetry(conversationId, PHONE, '4'),
    ]);

    const final = await getBotState(conversationId);
    assert.ok(
      final.context.college?.exam === EXAM_TS ||
        final.state === 'main_menu' ||
        final.context.college?.rank != null
    );
    assert.ok(apiCalls.length <= 1, `expected at most 1 API call, got ${apiCalls.length}`);
    const lockFailures = outcomes.filter((o) => o.status === 'rejected');
    assert.ok(lockFailures.length <= 1);
  });

  test('five simultaneous college predictor messages', async () => {
    const apiCalls = [];
    setCollegePredictorDeps({ getPredictedColleges: makePredictor(apiCalls) });

    const messages = ['2', '15000', '4', '2', 'AGAIN'];
    const outcomes = await Promise.allSettled(
      messages.map((text, i) =>
        processCollegePredictorSlotWithRetry(conversationId, PHONE, text, { isNewEntry: i === 0 })
      )
    );

    const final = await getBotState(conversationId);
    assert.ok(final);
    assert.ok(apiCalls.length <= 1, `expected at most 1 API call, got ${apiCalls.length}`);
    const lockFailures = outcomes.filter(
      (o) => o.status === 'rejected' && o.reason?.name === 'OptimisticLockFailedError'
    );
    assert.ok(lockFailures.length <= 2, 'extreme burst may exhaust retries on a few messages');
  });

  test('rapid slot sequence exam rank category gender — serial baseline', async () => {
    const apiCalls = [];
    setCollegePredictorDeps({ getPredictedColleges: makePredictor(apiCalls) });

    const steps = ['2', '18453', '4', '2'];
    let last;
    for (let i = 0; i < steps.length; i++) {
      last = await processCollegePredictorSlotWithRetry(conversationId, PHONE, steps[i], {
        isNewEntry: i === 0,
      });
    }

    assert.equal(last.clearState, true);
    assert.equal(apiCalls.length, 1);
    assert.equal(apiCalls[0].body.rank, 18453);
    const final = await getBotState(conversationId);
    assert.equal(final.state, 'main_menu');
    assert.deepEqual(final.context.college, {});
  });

  test('rapid slot sequence exam rank category gender — concurrent delivery', async () => {
    const apiCalls = [];
    setCollegePredictorDeps({ getPredictedColleges: makePredictor(apiCalls) });

    const steps = [
      { text: '2', isNewEntry: true },
      { text: '18453', isNewEntry: false },
      { text: '4', isNewEntry: false },
      { text: '2', isNewEntry: false },
    ];

    const outcomes = await Promise.allSettled(
      steps.map((step) =>
        processCollegePredictorSlotWithRetry(conversationId, PHONE, step.text, {
          isNewEntry: step.isNewEntry,
        })
      )
    );

    const final = await getBotState(conversationId);
    assert.ok(final);
    assert.ok(apiCalls.length <= 1, `expected at most 1 API call, got ${apiCalls.length}`);

    const lockFailures = outcomes.filter(
      (o) => o.status === 'rejected' && o.reason?.name === 'OptimisticLockFailedError'
    );
    assert.ok(lockFailures.length <= 1, 'at most one message should exhaust retries');

    if (apiCalls.length === 1) {
      assert.equal(apiCalls[0].exam, EXAM_TS);
      assert.equal(apiCalls[0].body.rank, 18453);
      assert.equal(final.state, 'main_menu');
    } else {
      assert.equal(apiCalls.length, 0, 'incomplete concurrent slots must not call predictor');
      assert.equal(final.state, 'college_predictor');
      assert.equal(final.context.college.exam, EXAM_TS);
    }
  });

  test('runWithOptimisticLockRetry exhausts after max attempts', async () => {
    let attempts = 0;
    await assert.rejects(
      runWithOptimisticLockRetry({
        conversationId,
        phone10: PHONE,
        maxAttempts: MAX_OPTIMISTIC_LOCK_RETRIES,
        operation: async () => {
          attempts += 1;
          throw new OptimisticLockConflictError({
            conversationId: String(conversationId),
            phone10: PHONE,
            previousVersion: 1,
            currentVersion: 2,
          });
        },
      }),
      OptimisticLockFailedError
    );
    assert.equal(attempts, MAX_OPTIMISTIC_LOCK_RETRIES);
    const metrics = getOptimisticLockMetrics();
    assert.ok(metrics.failed >= 1);
  });

  test('optimistic lock metrics track conflicts and latency', async () => {
    resetOptimisticLockMetrics();
    await transitionState(conversationId, PHONE, 'main_menu', {});
    await transitionState(conversationId, PHONE, 'college_predictor', { college: {} });
    const metrics = getOptimisticLockMetrics();
    assert.ok(metrics.updateCount >= 2);
    assert.ok(metrics.avgUpdateLatencyMs >= 0);
    assert.equal(metrics.failed, 0);
  });
});
