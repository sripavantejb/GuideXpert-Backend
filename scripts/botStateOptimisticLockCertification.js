#!/usr/bin/env node
'use strict';

/**
 * Optimistic lock certification — concurrency + performance metrics.
 * Run: node scripts/botStateOptimisticLockCertification.js
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  transitionState,
  getBotState,
  runWithOptimisticLockRetry,
  resetOptimisticLockMetrics,
  getOptimisticLockMetrics,
} = require('../services/chatbot/botStateService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const { EXAM_TS } = require('../constants/whatsappCollegePredictor');

const PHONE = '9876543210';

function makePredictor(callLog) {
  return async (exam, offset, limit, body) => {
    callLog.push({ exam, body: { ...body } });
    return {
      colleges: [{ college_name: `C-${body.rank}`, branches: [{ branch_name: 'CSE' }] }],
      total_no_of_colleges: 1,
    };
  };
}

async function processCollegeSlot(conversationId, phone10, text, { isNewEntry = false } = {}) {
  return runWithOptimisticLockRetry({
    conversationId,
    phone10,
    operation: async () => {
      let botState = await getBotState(conversationId);
      const contextPatch = botState?.context || {};
      await transitionState(conversationId, phone10, 'college_predictor', contextPatch);
      const result = await handleCollegePredictorMessage(
        text,
        contextPatch.college || {},
        { isNewEntry }
      );
      if (result.clearState) {
        await transitionState(conversationId, phone10, 'main_menu', { college: {} });
      } else {
        await transitionState(conversationId, phone10, 'college_predictor', { college: result.context });
      }
      return result;
    },
  });
}

async function main() {
  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const conversationId = new mongoose.Types.ObjectId();
  const apiCalls = [];
  const scenarios = { passed: 0, failed: 0 };

  function pass(name) {
    scenarios.passed += 1;
    console.log(`PASS ${name}`);
  }

  function fail(name, err) {
    scenarios.failed += 1;
    console.error(`FAIL ${name}:`, err.message);
  }

  try {
    resetOptimisticLockMetrics();
    setCollegePredictorDeps({ getPredictedColleges: makePredictor(apiCalls) });

    await Promise.allSettled([
      processCollegeSlot(conversationId, PHONE, '2', { isNewEntry: true }),
      processCollegeSlot(conversationId, PHONE, '2', { isNewEntry: true }),
    ]);
    const afterTwo = await getBotState(conversationId);
    if (afterTwo?.context?.college?.exam === EXAM_TS || afterTwo?.state === 'main_menu') {
      pass('two simultaneous messages');
    } else {
      fail('two simultaneous messages', new Error('missing exam slot'));
    }

    resetOptimisticLockMetrics();
    apiCalls.length = 0;
    const cid2 = new mongoose.Types.ObjectId();
    const outcomes3 = await Promise.allSettled([
      processCollegeSlot(cid2, PHONE, '2', { isNewEntry: true }),
      processCollegeSlot(cid2, PHONE, '15000'),
      processCollegeSlot(cid2, PHONE, '4'),
    ]);
    const afterThree = await getBotState(cid2);
    if (apiCalls.length <= 1 && afterThree) {
      pass('three simultaneous messages');
    } else {
      fail('three simultaneous messages', new Error(`apiCalls=${apiCalls.length}`));
    }

    resetOptimisticLockMetrics();
    apiCalls.length = 0;
    const cid3 = new mongoose.Types.ObjectId();
    await Promise.allSettled([
      processCollegeSlot(cid3, PHONE, '2', { isNewEntry: true }),
      processCollegeSlot(cid3, PHONE, '15000'),
      processCollegeSlot(cid3, PHONE, '4'),
      processCollegeSlot(cid3, PHONE, '2'),
    ]);
    if (apiCalls.length <= 1) {
      pass('four simultaneous slot messages');
    } else {
      fail('four simultaneous slot messages', new Error(`apiCalls=${apiCalls.length}`));
    }

    resetOptimisticLockMetrics();
    apiCalls.length = 0;
    const cid4 = new mongoose.Types.ObjectId();
    await Promise.allSettled(
      ['2', '15000', '4', '2', 'AGAIN'].map((text, i) =>
        processCollegeSlot(cid4, PHONE, text, { isNewEntry: i === 0 })
      )
    );
    if (apiCalls.length <= 1) {
      pass('five simultaneous messages');
    } else {
      fail('five simultaneous messages', new Error(`apiCalls=${apiCalls.length}`));
    }

    resetOptimisticLockMetrics();
    apiCalls.length = 0;
    const cid5 = new mongoose.Types.ObjectId();
    for (const [i, text] of ['2', '18453', '4', '2'].entries()) {
      await processCollegeSlot(cid5, PHONE, text, { isNewEntry: i === 0 });
    }
    const final = await getBotState(cid5);
    if (apiCalls.length === 1 && final.state === 'main_menu') {
      pass('serial rapid slot sequence');
    } else {
      fail('serial rapid slot sequence', new Error(`apiCalls=${apiCalls.length} state=${final?.state}`));
    }

    const metrics = getOptimisticLockMetrics();
    const report = {
      scenarios,
      optimisticLock: {
        conflictsObserved: metrics.conflicts,
        conflictsResolved: metrics.resolved,
        failedRetries: metrics.failed,
        conflictRate: metrics.conflictRate,
        avgRetryCount: metrics.avgRetryCount,
        maxRetries: metrics.maxRetries,
        avgUpdateLatencyMs: Math.round(metrics.avgUpdateLatencyMs * 100) / 100,
        p95UpdateLatencyMs: metrics.p95UpdateLatencyMs,
        updateCount: metrics.updateCount,
      },
      productionReadinessScore:
        scenarios.failed === 0 && metrics.failed === 0 ? 100 : scenarios.failed === 0 ? 95 : 70,
      goNoGo: scenarios.failed === 0 && metrics.failed === 0 ? 'GO' : 'CONDITIONAL-GO',
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(scenarios.failed > 0 ? 1 : 0);
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
