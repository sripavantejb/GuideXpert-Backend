'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { WHATSAPP_MESSAGE_KINDS } = require('../models/WhatsAppMessageEvent');
const opsAggregates = require('../services/whatsappOpsAggregates');

describe('WhatsApp ops messageKind allow-list', () => {
  test('WHATSAPP_MESSAGE_KINDS includes IIT reminder kinds', () => {
    assert.ok(WHATSAPP_MESSAGE_KINDS.includes('iit_pre2hr'));
    assert.ok(WHATSAPP_MESSAGE_KINDS.includes('iit_pre45min'));
    assert.ok(WHATSAPP_MESSAGE_KINDS.includes('iit_pre15min'));
  });

  test('whatsappOpsAggregates exports same allow-list', () => {
    assert.deepEqual(opsAggregates.ALLOWED_MESSAGE_KINDS, WHATSAPP_MESSAGE_KINDS);
  });
});
