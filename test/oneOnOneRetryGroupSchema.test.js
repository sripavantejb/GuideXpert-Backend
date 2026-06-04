'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');

describe('WhatsAppRetryGroup schema — one_on_one_submit', () => {
  test('accepts messageKind and trigger one_on_one_submit', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'one_on_one_submit',
      trigger: 'one_on_one_submit',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.equal(err, undefined);
  });

  test('rejects unknown messageKind', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'not_a_real_kind',
      trigger: 'one_on_one_submit',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.ok(err);
    assert.ok(err.errors.messageKind);
  });

  test('rejects unknown trigger', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'one_on_one_submit',
      trigger: 'form_submit',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.ok(err);
    assert.ok(err.errors.trigger);
  });
});
