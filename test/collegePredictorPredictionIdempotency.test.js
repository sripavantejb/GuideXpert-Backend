'use strict';

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
const {
  handleCollegePredictorMessage,
  runPrediction,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const {
  setCollegePredictionIdempotencyDeps,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictionIdempotencyService');
const {
  transitionState,
  runWithOptimisticLockRetry,
  OptimisticLockConflictError,
} = require('../services/chatbot/botStateService');
const { EXAM_TS } = require('../constants/whatsappCollegePredictor');

const PHONE = '9876543210';
const MOCK_COLLEGES = {
  colleges: [{ college_name: 'Test College', branches: [{ branch_name: 'CSE' }] }],
  total_no_of_colleges: 1,
};

function makeCtx() {
  return {
    flow: 'college_predictor',
    step: 'gender',
    conversational: true,
    exam: EXAM_TS,
    rank: 18453,
    categoryN: 4,
    categoryLabel: 'BC-C',
    gender: 'F',
    reservation_category_codes: ['BCCF'],
  };
}

function makePredictor(apiCalls) {
  return async (exam, offset, limit, body) => {
    apiCalls.push({ exam, body });
    return { ...MOCK_COLLEGES };
  };
}

async function createInbound(conversationId) {
  return WhatsAppInboundMessage.create({
    conversationId,
    phone: PHONE,
    messageType: 'text',
    text: '2',
    processStatus: 'processing',
    receivedAt: new Date(),
  });
}

describe('collegePredictor prediction idempotency', () => {
  let mongoServer;
  let conversationId;
  let apiCalls;
  let analyticsEvents;

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
    apiCalls = [];
    analyticsEvents = [];
    setCollegePredictorDeps({
      getPredictedColleges: makePredictor(apiCalls),
      logChatbotEvent: (event, fields) => {
        analyticsEvents.push({ event, fields });
      },
    });
    setCollegePredictionIdempotencyDeps({ WhatsAppInboundMessage });
    await mongoose.connection.collection('whatsappinboundmessages').deleteMany({});
    await mongoose.connection.collection('whatsappbotstates').deleteMany({});
  });

  afterEach(() => {
    setCollegePredictorDeps({});
    setCollegePredictionIdempotencyDeps({});
  });

  test('runPrediction calls API once and analytics once on replay', async () => {
    const inbound = await createInbound(conversationId);
    const ctx = makeCtx();
    const opts = { inboundId: inbound._id };

    const first = await runPrediction(ctx, opts);
    assert.equal(apiCalls.length, 1);
    // Sticky results mode: keep college_predictor state after first prediction.
    assert.equal(first.clearState, false);
    assert.equal(first.idempotentReplay, undefined);

    const second = await runPrediction(ctx, opts);
    assert.equal(apiCalls.length, 1, 'API must not run on replay');
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.reply, first.reply);

    const successEvents = analyticsEvents.filter((e) => e.event === 'predictor_success');
    assert.equal(successEvents.length, 1, 'analytics emitted exactly once');
  });

  test('handleCollegePredictorMessage replay after inbound completion', async () => {
    const inbound = await createInbound(conversationId);
    const ctx = makeCtx();
    const opts = { inboundId: inbound._id };

    await runPrediction(ctx, opts);
    const replay = await handleCollegePredictorMessage('2', ctx, opts);
    assert.equal(apiCalls.length, 1);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(analyticsEvents.filter((e) => e.event === 'predictor_success').length, 1);
  });

  test('optimistic lock retry after API success — single API, analytics, reply', async () => {
    const inbound = await createInbound(conversationId);
    const inboundId = inbound._id;
    let transitionCalls = 0;
    let outboundCalls = 0;

    const ctx = makeCtx();
    const opts = { inboundId };

    const processCollegeCompletion = async () => {
      const c = await runPrediction(ctx, opts);
      transitionCalls += 1;
      await transitionState(conversationId, PHONE, 'college_predictor', {
        predictionIdempotency: c.predictionIdempotency,
        college: {},
      });
      if (transitionCalls === 1) {
        throw new OptimisticLockConflictError({
          conversationId: String(conversationId),
          phone10: PHONE,
          previousVersion: 1,
          currentVersion: 2,
        });
      }
      outboundCalls += 1;
      return c;
    };

    const result = await runWithOptimisticLockRetry({
      conversationId,
      phone10: PHONE,
      operation: async () => processCollegeCompletion(),
    });

    assert.ok(result.reply);
    assert.equal(apiCalls.length, 1);
    assert.equal(analyticsEvents.filter((e) => e.event === 'predictor_success').length, 1);
    assert.equal(outboundCalls, 1);
  });

  test('bot context predictionIdempotency supports retry before inbound read', async () => {
    const inbound = await createInbound(conversationId);
    const ctx = makeCtx();
    const opts = { inboundId: inbound._id };

    const first = await runPrediction(ctx, opts);
    await transitionState(conversationId, PHONE, 'college_predictor', {
      predictionIdempotency: first.predictionIdempotency,
      college: {},
    });

    await WhatsAppInboundMessage.updateOne(
      { _id: inbound._id },
      { $unset: { collegePrediction: 1 } }
    );

    const replay = await runPrediction(ctx, {
      inboundId: inbound._id,
      predictionIdempotency: first.predictionIdempotency,
    });

    assert.equal(apiCalls.length, 1);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(analyticsEvents.filter((e) => e.event === 'predictor_success').length, 1);
  });

  test('multiple runWithOptimisticLockRetry attempts — metrics 1:1:1', async () => {
    const inbound = await createInbound(conversationId);
    const ctx = makeCtx();
    let attempts = 0;

    await runWithOptimisticLockRetry({
      conversationId,
      phone10: PHONE,
      operation: async () => {
        attempts += 1;
        const c = await runPrediction(ctx, { inboundId: inbound._id });
        if (attempts < 3) {
          throw new OptimisticLockConflictError({
            conversationId: String(conversationId),
            phone10: PHONE,
            previousVersion: attempts,
            currentVersion: attempts + 1,
          });
        }
        return c;
      },
    });

    assert.equal(attempts, 3);
    assert.equal(apiCalls.length, 1);
    assert.equal(analyticsEvents.filter((e) => e.event === 'predictor_success').length, 1);
  });
});
