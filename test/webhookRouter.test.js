'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyWebhookBody, isRequestWelcome } = require('../services/chatbot/webhookRouterService');

describe('classifyWebhookBody', () => {
  test('returns request_welcome for Gupshup outer type request_welcome', () => {
    const body = { type: 'request_welcome', payload: { source: '919876543210' } };
    assert.equal(classifyWebhookBody(body).kind, 'request_welcome');
  });

  test('returns request_welcome for Gupshup payload.type request_welcome', () => {
    const body = { type: 'message', payload: { type: 'request_welcome', source: '919876543210' } };
    assert.equal(classifyWebhookBody(body).kind, 'request_welcome');
  });

  test('returns request_welcome for Meta entry messages type request_welcome', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ type: 'request_welcome', from: '919876543210' }],
              },
            },
          ],
        },
      ],
    };
    assert.equal(classifyWebhookBody(body).kind, 'request_welcome');
  });

  test('returns inbound for a normal text message', () => {
    const body = {
      type: 'message',
      payload: {
        source: '919876543210',
        id: 'msg-123',
        payload: {
          message: { type: 'text', text: 'hi' },
        },
      },
    };
    const result = classifyWebhookBody(body);
    assert.equal(result.kind, 'inbound');
  });

  test('returns dlr for an outbound status webhook', () => {
    const body = { type: 'message-event', payload: { type: 'enqueued', gsId: 'abc123' } };
    assert.equal(classifyWebhookBody(body).kind, 'dlr');
  });

  test('isRequestWelcome is case-insensitive', () => {
    assert.equal(isRequestWelcome({ type: 'REQUEST_WELCOME' }), true);
    assert.equal(isRequestWelcome({ type: 'Request_Welcome' }), true);
    assert.equal(isRequestWelcome({ type: 'message' }), false);
    assert.equal(isRequestWelcome(null), false);
    assert.equal(isRequestWelcome({}), false);
  });
});
