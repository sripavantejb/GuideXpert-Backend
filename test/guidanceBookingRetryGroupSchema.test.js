'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');

describe('WhatsAppRetryGroup schema — guidance_booking_submit', () => {
  test('accepts messageKind and trigger guidance_booking_submit', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'guidance_booking_submit',
      trigger: 'guidance_booking_submit',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.equal(err, undefined);
  });

  test('rejects unknown messageKind', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'not_a_real_kind',
      trigger: 'guidance_booking_submit',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.ok(err);
    assert.ok(err.errors.messageKind);
  });

  test('rejects unknown trigger', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'guidance_booking_submit',
      trigger: 'book_slot',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.ok(err);
    assert.ok(err.errors.trigger);
  });
});
