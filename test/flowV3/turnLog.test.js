'use strict';

require('../../config/mongooseSafety');

const { after, before, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { hashPhoneOrThrow } = require('../../services/chatbot/flowV3LLM/profile/flowV3PhoneHash');

const PHONE = '9876543210';
const PEPPER = 'turnlog-test-pepper';

let memoryServer;
let FlowV3TurnLog;
let phoneHash;

function baseTurn(overrides = {}) {
  return {
    turnId: 'turn-1',
    conversationId: new mongoose.Types.ObjectId(),
    phoneHash,
    inboundId: 'inbound-1',
    promptVersion: 'v1',
    promptHash: 'abc123',
    model: 'test-model',
    inboundText: 'my rank is 15000, what colleges can I get',
    ...overrides,
  };
}

describe('FlowV3TurnLog — §9.3 shape', () => {
  before(async () => {
    phoneHash = hashPhoneOrThrow(PHONE, { pepper: PEPPER });
    FlowV3TurnLog = require('../../models/FlowV3TurnLog');
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(), {
      dbName: 'flow_v3_turn_log',
      serverSelectionTimeoutMS: 10000,
    });
    await FlowV3TurnLog.syncIndexes();
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  });

  beforeEach(async () => {
    await FlowV3TurnLog.deleteMany({});
  });

  test('stores every §9.3 section of a turn', async () => {
    const doc = await FlowV3TurnLog.create(
      baseTurn({
        gateVerdicts: [
          { gate: 'G-CRISIS', verdict: 'pass' },
          { gate: 'G-DEMOGRAPHIC', verdict: 'pass', reason: 'category/gender absent' },
        ],
        profileBefore: { rank: null },
        slotPatch: { rank: 15000 },
        profileAfter: { rank: 15000 },
        llmCalls: [
          { callIndex: 1, messages: [{ role: 'system', content: 'prompt' }], rawResponse: { text: '{}' }, tokensIn: 900, tokensOut: 120, latencyMs: 2400 },
        ],
        toolCalls: [
          { name: 'next_question', args: {}, result: { slot: 'goal' }, latencyMs: 3, cached: false },
          { name: 'get_predictor_matches', args: { rank: 15000 }, result: { catalog: 'predictor', rows: [] }, latencyMs: 2100 },
        ],
        envelope: { intent: 'ask_slot', parts: [{ type: 'text', body: 'What matters most?' }] },
        validationVerdicts: [
          { check: 'V-2', verdict: 'pass' },
          { check: 'V-7', verdict: 'clamp', detail: 'buttons trimmed 4 → 3' },
        ],
        blocked: false,
        regenerated: false,
        fallbackTier: null,
        sentParts: [
          { partIndex: 0, type: 'text', body: 'What matters most?', providerMessageId: 'gs-1', sent: true },
          { partIndex: 1, type: 'buttons', body: 'Pick one', providerMessageId: 'gs-2', sent: true },
        ],
        deliveryStatus: 'sent',
        latencyBreakdown: { gatesMs: 40, profileLoadMs: 60, llmCall1Ms: 2400, toolsMs: 2100, llmCall2Ms: 2200, validationMs: 30, renderMs: 20, totalMs: 6850 },
      })
    );

    assert.equal(doc.gateVerdicts.length, 2);
    assert.equal(doc.llmCalls[0].tokensIn, 900);
    assert.equal(doc.toolCalls[1].name, 'get_predictor_matches');
    assert.equal(doc.validationVerdicts[1].verdict, 'clamp');
    assert.equal(doc.envelope.intent, 'ask_slot');
    assert.equal(doc.latencyBreakdown.totalMs, 6850);
    assert.ok(doc.createdAt instanceof Date);
  });

  test('multi-part sends are logged per partIndex (G-2b assertion surface)', async () => {
    const doc = await FlowV3TurnLog.create(
      baseTurn({
        envelope: { parts: [{ type: 'text' }, { type: 'buttons' }] },
        sentParts: [
          { partIndex: 0, type: 'text', sent: true },
          { partIndex: 1, type: 'buttons', sent: false, duplicatePrevented: true },
        ],
      })
    );

    assert.equal(doc.sentParts.length, doc.envelope.parts.length);
    assert.equal(doc.sentParts[1].duplicatePrevented, true);
  });

  test('turnId is unique — one document per turn', async () => {
    await FlowV3TurnLog.create(baseTurn());
    await assert.rejects(() => FlowV3TurnLog.create(baseTurn()), (err) => err.code === 11000);
  });

  test('required identity fields are enforced', async () => {
    for (const missing of ['turnId', 'conversationId', 'promptVersion']) {
      const payload = baseTurn();
      delete payload[missing];
      await assert.rejects(
        () => FlowV3TurnLog.create(payload),
        (err) => {
          assert.equal(err.name, 'ValidationError');
          assert.ok(err.errors[missing], `${missing} should be required`);
          return true;
        }
      );
    }
  });

  test('phoneHash must be a sha256 digest, never a raw phone', async () => {
    for (const bad of [PHONE, `+91${PHONE}`, 'ABC', 'A'.repeat(64)]) {
      await assert.rejects(
        () => FlowV3TurnLog.create(baseTurn({ phoneHash: bad })),
        (err) => {
          assert.equal(err.name, 'ValidationError');
          assert.ok(err.errors.phoneHash, `${bad} should fail phoneHash validation`);
          return true;
        }
      );
    }
    assert.equal(FlowV3TurnLog.schema.path('phone'), undefined, 'a raw phone path must not exist');
  });

  test('phoneHash is null when the pepper is unavailable, never an unpeppered digest', async () => {
    const payload = baseTurn();
    delete payload.phoneHash;
    const doc = await FlowV3TurnLog.create(payload);
    assert.equal(doc.phoneHash, null);
  });

  test('fallbackTier is limited to the §7.3 ladder', async () => {
    for (const tier of ['A', 'B', 'C']) {
      const doc = await FlowV3TurnLog.create(baseTurn({ turnId: `turn-${tier}`, fallbackTier: tier }));
      assert.equal(doc.fallbackTier, tier);
    }
    await assert.rejects(
      () => FlowV3TurnLog.create(baseTurn({ turnId: 'turn-D', fallbackTier: 'D' })),
      (err) => err.name === 'ValidationError'
    );
  });

  test('validation verdicts are limited to pass/block/clamp/warn', async () => {
    await assert.rejects(
      () => FlowV3TurnLog.create(baseTurn({ validationVerdicts: [{ check: 'V-2', verdict: 'maybe' }] })),
      (err) => err.name === 'ValidationError'
    );
  });

  test('the collection has NO TTL index — the eval corpus is never swept', async () => {
    const indexes = await FlowV3TurnLog.collection.indexes();
    for (const index of indexes) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(index, 'expireAfterSeconds'),
        false,
        `${index.name} is a TTL index`
      );
    }
    FlowV3TurnLog.schema.eachPath((path, type) => {
      assert.equal(type.options.expires, undefined, `${path} declares an expiry`);
    });
  });

  test('a turn is replayable: prompt version, model and profileBefore are all stored', async () => {
    await FlowV3TurnLog.create(
      baseTurn({ profileBefore: { goal: null, rank: null }, slotPatch: { goal: 'branch_fit' } })
    );
    const found = await FlowV3TurnLog.findOne({ turnId: 'turn-1' }).lean();
    assert.equal(found.promptVersion, 'v1');
    assert.equal(found.promptHash, 'abc123');
    assert.equal(found.model, 'test-model');
    assert.deepEqual(found.profileBefore, { goal: null, rank: null });
    assert.deepEqual(found.slotPatch, { goal: 'branch_fit' });
  });
});
