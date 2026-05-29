'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildInboundMessageFields, handleInboundWebhook } = require('../services/chatbot/whatsappInboundService');
const { assertBdaCanResolveHandoff } = require('../services/chatbot/handoffService');
const { isMongoDuplicateKeyError } = require('../utils/mongoDuplicateKey');

const INBOUND_BODY = {
  type: 'message',
  payload: {
    source: '919876543210',
    id: 'wamid.P0AUTH',
    payload: { type: 'text', text: 'hi' },
  },
};

describe('P0 inbound webhook auth', () => {
  let envSnap;

  beforeEach(() => {
    envSnap = {
      GUPSHUP_WEBHOOK_SECRET: process.env.GUPSHUP_WEBHOOK_SECRET,
      GUPSHUP_WEBHOOK_AUTH_REQUIRED: process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED,
    };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('handleInboundWebhook returns 401 when secret required and missing', async () => {
    process.env.GUPSHUP_WEBHOOK_SECRET = 'p0-test-secret';
    const r = await handleInboundWebhook({ headers: {} }, INBOUND_BODY, new Date());
    assert.equal(r.handled, false);
    assert.equal(r.statusCode, 401);
    assert.equal(r.error, 'unauthorized');
  });
});

describe('P0 inbound persist', () => {
  test('buildInboundMessageFields requires conversationId', () => {
    const conversationId = new mongoose.Types.ObjectId();
    const parsed = {
      phone10: '9876543210',
      providerMessageId: 'wamid.TEST',
      messageType: 'text',
      text: 'hello',
      interactivePayload: null,
      mediaUrl: null,
      location: null,
      receivedAt: new Date(),
    };
    const fields = buildInboundMessageFields({
      conversationId,
      parsed,
      body: { type: 'message' },
      receivedAt: new Date(),
      dedupeKey: 'dedupe-1',
      webhookEventId: new mongoose.Types.ObjectId(),
    });
    assert.equal(String(fields.conversationId), String(conversationId));
    assert.equal(fields.phone, '9876543210');
    assert.equal(fields.processStatus, 'pending');
    assert.notEqual(fields.conversationId, null);
  });
});

describe('P0 BDA resolve authorization', () => {
  const bdaA = new mongoose.Types.ObjectId();
  const bdaB = new mongoose.Types.ObjectId();

  test('admin resolve (no bdaId) allowed', () => {
    const r = assertBdaCanResolveHandoff(
      { route: 'bda', assignedBdaId: bdaA },
      null
    );
    assert.equal(r.ok, true);
  });

  test('assigned BDA can resolve bda handoff', () => {
    const r = assertBdaCanResolveHandoff(
      { route: 'bda', assignedBdaId: bdaA },
      bdaA
    );
    assert.equal(r.ok, true);
  });

  test('wrong BDA cannot resolve', () => {
    const r = assertBdaCanResolveHandoff(
      { route: 'bda', assignedBdaId: bdaA },
      bdaB
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_assigned');
  });

  test('BDA cannot resolve admin_pool handoff', () => {
    const r = assertBdaCanResolveHandoff(
      { route: 'admin_pool', assignedBdaId: null },
      bdaA
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_bda_handoff');
  });

  test('missing handoff returns not_found for BDA', () => {
    const r = assertBdaCanResolveHandoff(null, bdaA);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_found');
  });
});

describe('P0 conversation duplicate key', () => {
  test('isMongoDuplicateKeyError detects E11000', () => {
    assert.equal(isMongoDuplicateKeyError({ code: 11000 }), true);
    assert.equal(isMongoDuplicateKeyError({ message: 'E11000 duplicate key' }), true);
    assert.equal(isMongoDuplicateKeyError(new Error('other')), false);
  });
});
